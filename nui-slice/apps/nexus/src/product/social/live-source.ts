'use client';

/**
 * src/product/social/live-source.ts — Live SocialSource backed by RAE daemon (:5682).
 *
 * Implements the SocialSource contract by fetching from the local RAE daemon.
 * Fail-soft: if the daemon is unreachable, falls back to mock and adds
 * `source: 'mock'` badge to the hub state so the UI can show offline indicator.
 *
 * Data mapping:
 *   - RAE /api/rae/health → adapter state (mode, reason, breaker, strikes)
 *   - RAE /api/rae/items → SocialPost[] (queue + approvals merged by status)
 *   - RAE /api/rae/ui/social → aggregated screen payload (adapters + items + counts)
 */

import type {
  SocialSource,
  SocialHubState,
  SocialPost,
  SocialPostStatus,
  SocialMediaKind,
  SocialNetworkId,
  YouTubeVideo,
  YouTubeCommentRow,
  XTweet,
  XMention,
  SocialAccount,
  SocialAgentState,
  SocialAccountState,
} from '@nexus/mock-data';

// -----------------------------------------------------------------------------
// Types for RAE daemon responses
// -----------------------------------------------------------------------------

interface RaeAdapterState {
  network: string;
  mode: 'stealth' | 'open';
  state: string;
  reason: string | null;
  breaker: boolean;
  strikes: number;
}

interface RaeItem {
  id: string;
  network: string;
  status: string;
  approved: boolean;
  edited_since_approval: boolean;
  scheduled_at: string | null;
  remote_id: string | null;
  verified: boolean;
  /** RAE-UI-GAPS: полный текст поста (daemon отдаёт с 2026-11-09). */
  text?: string | null;
  /** Реальный автор поста, если daemon его сообщает (иначе 'rae'). */
  authorAgent?: string | null;
  verify_state?: string | null;
  verify_reason?: string | null;
  findings: { rule: string; severity: string; detail: string }[];
}

interface RaeHealthResponse {
  state: RaeAdapterState[];
  probes: Record<string, { ok: boolean; status: string; reason: string | null }>;
}

interface RaeStateResponse {
  adapters: RaeAdapterState[];
}

interface RaeItemsResponse {
  items: RaeItem[];
}

interface RaeUiItem {
  id: string;
  status: string;
  scheduled_at: string | null;
  remote_id: string | null;
  verified: boolean;
}

interface RaeUiSocialResponse {
  screen: string;
  mode: 'stealth' | 'open';
  adapters: Record<string, RaeAdapterState>;
  items: RaeUiItem[];
  counts: Record<string, number>;
}

/**
 * Реальный публичный канал AGENT-A (Telegram). Посты без токена
 * недоступны — экран показывает честный статус «канал задан, данные
 * постов — только через бот-токен/RAE».
 */
export const TELEGRAM_CHANNEL = '@AI2MINDAI3';
export const TELEGRAM_CHANNEL_NAME = 'AI2 MINDAI3 (AGENT-A)';

// Same-origin по умолчанию: публичный деплой проксирует /api/rae/* на демон.
// Для dev с туннелем: NEXT_PUBLIC_RAE_BASE=http://127.0.0.1:5682
const RAE_BASE_URL = process.env.NEXT_PUBLIC_RAE_BASE ?? '';
const REQUEST_TIMEOUT_MS = 4000;

// LocalStorage key for operator token
const OP_TOKEN_KEY = 'nexus.opToken';

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function getOpToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(OP_TOKEN_KEY);
  } catch {
    return null;
  }
}

function setOpToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) localStorage.setItem(OP_TOKEN_KEY, token);
    else localStorage.removeItem(OP_TOKEN_KEY);
  } catch {
    // ignore
  }
}

function hasOpToken(): boolean {
  return getOpToken() !== null;
}

// Sync operator token from profile (called on init)
export function syncOpTokenFromProfile(profileToken: string | null | undefined): void {
  if (profileToken) {
    setOpToken(profileToken);
  }
}

async function raeFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const token = getOpToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...init?.headers as Record<string, string>,
  };
  if (token) {
    headers['X-Nexus-Op'] = token;
  }
  try {
    const response = await fetch(`${RAE_BASE_URL}${path}`, {
      ...init,
      signal: controller.signal,
      headers,
    });
    if (!response.ok) {
      throw new Error(`RAE ${response.status}: ${response.statusText}`);
    }
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

async function raeFetchOrNull<T>(path: string, init?: RequestInit): Promise<T | null> {
  try {
    return await raeFetch<T>(path, init);
  } catch {
    return null;
  }
}

// Map RAE status → SocialPostStatus
function mapRaeStatusToPostStatus(raeStatus: string): SocialPostStatus {
  switch (raeStatus) {
    case 'draft':
      return 'draft';
    case 'pending-approval':
      return 'pending-approval';
    case 'scheduled':
      return 'scheduled';
    case 'published':
      return 'published';
    case 'rejected':
      return 'rejected';
    default:
      return 'draft';
  }
}

// Map RAE adapter state → SocialAccountState
function mapRaeStateToAccountState(raeState: string): SocialAccountState {
  switch (raeState) {
    case 'connected':
      return 'connected';
    case 'not-connected':
      return 'not-connected';
    case 'needs-permission':
      return 'needs-permission';
    case 'needs-review':
      return 'needs-review';
    case 'rate-limited':
      return 'rate-limited';
    case 'error':
      return 'error';
    case 'offline':
      return 'unavailable';
    default:
      return 'unavailable';
  }
}

// Map RAE mode → SocialSource mode
function mapRaeMode(mode: 'stealth' | 'open'): 'stealth' | 'open' {
  return mode === 'stealth' ? 'stealth' : 'open';
}

// Convert RAE item → SocialPost
function raeItemToSocialPost(item: RaeItem): SocialPost {
  return {
    id: item.id,
    network: item.network as SocialNetworkId,
    // RAE-UI-GAPS: daemon отдаёт text — показываем его; пусто → честно пусто.
    text: item.text ?? '',
    media: 'text' as SocialMediaKind, // not in RAE item; default
    status: mapRaeStatusToPostStatus(item.status),
    scheduledAt: item.scheduled_at,
    // Реальный автор, если daemon сообщает; иначе честное 'rae' (pipeline RAE).
    authorAgent: item.authorAgent ?? 'rae',
    verified: item.verify_state != null ? item.verify_state === 'verified' : item.verified,
    verifyReason: item.verify_reason ?? null,
    findings: item.findings ?? [],
  };
}

// Convert RAE adapter state → SocialAccount
function raeAdapterToSocialAccount(adapter: RaeAdapterState): SocialAccount {
  return {
    network: adapter.network as SocialNetworkId,
    handle: null, // not in RAE adapter state; would need /api/rae/ui/social
    state: mapRaeStateToAccountState(adapter.state),
    followers: null,
    reason: adapter.reason,
  };
}

// Build SocialAgentState from RAE adapters/items
function buildSocialAgentState(
  mode: 'stealth' | 'open',
  items: RaeItem[]
): SocialAgentState {
  // Count pending approvals
  const pendingApprovals = items.filter((i) => i.status === 'pending-approval').length;

  // Determine agent state based on pipeline activity
  let agentState: SocialAgentState['state'] = 'idle';
  if (pendingApprovals > 0) agentState = 'awaiting-approval';
  else if (items.some((i) => i.status === 'draft')) agentState = 'drafting';
  else if (items.some((i) => i.status === 'scheduled')) agentState = 'scheduling';

  // Только реальные задачи из реальных сущностей RAE; ничего выдуманного.
  const realTasks = items.filter((i) => i.status === 'draft').map((i) => `${i.network}: черновик»${i.id}`);
  const scheduledCount = items.filter((i) => i.status === 'scheduled').length;

  return {
    operator: 'AGENT-A',
    state: agentState,
    currentTask: pendingApprovals > 0
      ? `${pendingApprovals} пост(ов) на утверждении`
      : realTasks.length > 0
        ? `генерация черновиков: ${realTasks.join(', ')}`
        : scheduledCount > 0
          ? `планирование публикаций (${scheduledCount})`
          : null,
    subAgents: [
      // Реальные роли фермы. Задачи заполняются ТОЛЬКО из реальных данных
      // RAE/nexus-core — недоступность = честный null, а не выдумка.
      { key: 'spark', task: null },
      { key: 'codex', task: null },
      { key: 'forge', task: null },
      { key: 'neo2', task: null },
    ],
  };
}

// -----------------------------------------------------------------------------
// Live SocialSource implementation
// -----------------------------------------------------------------------------

let _mode: 'stealth' | 'open' = 'open';
let _offline = false; // cached offline state
let _lastApprovalError: string | null = null;

/** Reason the last approve/reject POST failed (null = no error yet). */
export function getApprovalError(): string | null {
  return _lastApprovalError;
}

export function createLiveSocialSource(): SocialSource {
  return {
    get mode() {
      return _mode;
    },

    setMode: async (mode: 'stealth' | 'open') => {
      _mode = mode;
      // RAE daemon mode is set at startup via RAE_MODE env; we can't change it at runtime.
      // Return current hub state (will be mock if offline).
      const hub = await fetchHubState();
      return hub;
    },

    getState: async () => {
      return fetchHubState();
    },

    listQueue: async () => {
      const items = await fetchItems();
      return items
        .filter((i) => ['scheduled', 'published'].includes(i.status))
        .map(raeItemToSocialPost);
    },

    listApprovals: async () => {
      const items = await fetchItems();
      return items
        .filter((i) => i.status === 'pending-approval')
        .map(raeItemToSocialPost);
    },

    respondApproval: async (id: string, decision: 'approve' | 'reject', reason?: string | null) => {
      _lastApprovalError = null;
      const endpoint = decision === 'approve' ? '/api/rae/approve' : '/api/rae/reject';
      if (!hasOpToken()) {
        _lastApprovalError = 'Операторский ключ не задан — укажите в Настройках → Соцсети';
        return null;
      }
      try {
        await raeFetch(endpoint, {
          method: 'POST',
          body: JSON.stringify({ item_id: id, by: 'ui', ...(reason ? { reason } : {}) }),
        });
        const items = await fetchItems();
        const updated = items.find((i) => i.id === id);
        return updated ? raeItemToSocialPost(updated) : null;
      } catch (e) {
        _lastApprovalError = e instanceof Error
          ? e.message
          : 'RAE approval endpoint недоступен';
        return null;
      }
    },

    createDraft: async (input) => {
      // Live mode: drafts are born in the planning pipeline (python -m tools.rae.operator),
      // not from the web UI. Honest refusal instead of a fake local post.
      if (!hasOpToken()) {
        throw new Error('Операторский ключ не задан — укажите в Настройках → Соцсети');
      }
      throw new Error('Драфты рождаются в planning pipeline (python -m tools.rae.operator)');
    },

    youtube: {
      listVideos: async () => {
        const items = await fetchItems();
        return items
          .filter((i) => i.network === 'youtube')
          .map((i) => ({
            videoId: i.remote_id ?? i.id,
            title: '',
            publishedAt: i.scheduled_at ?? new Date().toISOString(),
            views: null,
            comments: null,
          }));
      },
      listComments: async (videoId: string) => {
        return []; // RAE doesn't expose comments
      },
    },

    x: {
      listTweets: async () => {
        const items = await fetchItems();
        return items
          .filter((i) => i.network === 'x')
          .map((i) => ({
            tweetId: i.remote_id ?? i.id,
            text: '',
            ts: i.scheduled_at ? Date.parse(i.scheduled_at) / 1000 : Date.now() / 1000,
            likes: null,
            reposts: null,
          }));
      },
      listMentions: async () => {
        return []; // RAE doesn't expose mentions
      },
    },
  };
}

// -----------------------------------------------------------------------------
// Fetch functions with offline caching
// -----------------------------------------------------------------------------

async function fetchHealth(): Promise<RaeHealthResponse | null> {
  return raeFetchOrNull<RaeHealthResponse>('/api/rae/health');
}

async function fetchItems(): Promise<RaeItem[]> {
  const data = await raeFetchOrNull<RaeItemsResponse>('/api/rae/items');
  return data?.items ?? [];
}

async function fetchHubState(): Promise<SocialHubState> {
  const [health, items] = await Promise.all([fetchHealth(), fetchItems()]);

  _offline = health === null;

  if (!health) {
    // RAE недоступен → честный пустой статус, никаких выдуманных данных.
    _offline = true;
    return {
      agent: {
        operator: 'AGENT-A',
        state: 'offline',
        currentTask: 'RAE демон недоступен — реальные данные отсутствуют',
        subAgents: [
          { key: 'spark', task: null },
          { key: 'codex', task: null },
          { key: 'forge', task: null },
          { key: 'neo2', task: null },
        ],
      },
      accounts: [],
      mode: _mode,
      source: 'mock-offline',
    };
  }

  const accounts = health.state.map(raeAdapterToSocialAccount);
  const agent = buildSocialAgentState(health.state[0]?.mode ?? 'open', items);

  return { agent, accounts, mode: _mode, source: 'live' };
}

// -----------------------------------------------------------------------------
// Export for composition in data-source.ts
// -----------------------------------------------------------------------------

export function isRaeAvailable(): Promise<boolean> {
  return fetchHealth().then((h) => h !== null);
}

export function getRaeMode(): 'stealth' | 'open' {
  return _mode;
}

export function setRaeMode(mode: 'stealth' | 'open'): void {
  _mode = mode;
}