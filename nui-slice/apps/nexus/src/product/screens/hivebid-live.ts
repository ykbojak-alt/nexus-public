import type { AgentRatings } from './newf-live';

/**
 * Perf (NUE-UI perf-budget dozhim): near-api-js (~267 KB raw) тянул
 * /hivebid выше лимита 1000 KB. Здесь остались два его использования,
 * оба тривиально заменяются нативным кодом:
 * - formatNearAmount → formatYoctoAmount (yoctoNEAR → строка NEAR);
 * - JsonRpcProvider.callFunction → view() (JSON-RPC fetch, тот же контракт).
 * Поведение сохраняется: тест hivebid-live.test.ts (fetch-мок) проходит без изменений.
 */

/** Конфигурируемый RPC-эндпоинт NEAR. Приоритет: JSON-панель экрана → env → testnet по умолчанию. */
export const DEFAULT_RPC_URL = 'https://rpc.testnet.near.org';
export const DEFAULT_CONTRACT_ID = 'hivebid-market.testnet';

let envRpc: string | undefined;
let envContract: string | undefined;
try {
  envRpc = process.env.NEXUS_HIVEBID_RPC_URL || undefined;
  envContract = process.env.NEXUS_HIVEBID_CONTRACT_ID || undefined;
} catch {
  // SSR/тесты без env — молча, fallback.
}

export function resolveRpcUrl(panel?: string): string {
  const url = panel?.trim() || envRpc || DEFAULT_RPC_URL;
  return /^https?:\/\//.test(url) ? url : DEFAULT_RPC_URL;
}

export function resolveContractId(panel?: string): string {
  const id = panel?.trim() || envContract || DEFAULT_CONTRACT_ID;
  return /^[a-z0-9._-]+$/.test(id) ? id : DEFAULT_CONTRACT_ID;
}

/** Сохранённая пользователем конфигурация подключения (contract + RPC). */
export interface HiveBidConfig {
  rpcUrl?: string;
  contractId?: string;
}

const CONFIG_KEY = 'hivebid.config.v1';

export function loadHiveBidConfig(): HiveBidConfig {
  try {
    const raw = globalThis.localStorage?.getItem(CONFIG_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as HiveBidConfig;
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveHiveBidConfig(config: HiveBidConfig): void {
  try {
    globalThis.localStorage?.setItem(CONFIG_KEY, JSON.stringify(config));
  } catch {
    // SSR / приватный режим без localStorage — молча.
  }
}

export function formatYocto(yocto: string | number | undefined | null): string {
  if (yocto === undefined || yocto === null) return '—';
  const amount = formatYoctoAmount(String(yocto));
  const n = Number(amount);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `${Math.round(n).toLocaleString('en-US')} Ⓝ`;
  if (n >= 1) return `${n.toFixed(2)} Ⓝ`;
  if (n >= 0.001) return `${n.toFixed(4)} Ⓝ`;
  return `${n.toExponential(1)} Ⓝ`;
}

/** yoctoNEAR (до 24 знаков) → строка NEAR без экспоненты, хвостовые нули обрезаны. */
function formatYoctoAmount(yocto: string): string {
  let s = yocto.trim();
  if (!s || s === '0') return '0';
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  s = s.replace(/^0+/, '') || '0';
  const padded = s.padStart(25, '0'); // ≥1 целая цифра + 24 дробных
  const intPart = padded.slice(0, -24).replace(/^0+/, '') || '0';
  const fracPart = padded.slice(-24).replace(/0+$/, '');
  const out = fracPart ? `${intPart}.${fracPart}` : intPart;
  return neg ? `-${out}` : out;
}

export function formatEta(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || ms <= 0) return '—';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

export type LotStatusKind =
  | 'open' | 'bids-closed' | 'awarded' | 'submitted' | 'rework'
  | 'completed' | 'partial' | 'failed' | 'cancelled' | 'late';

export const LOT_STATUS_ORDER: LotStatusKind[] = [
  'open', 'bids-closed', 'awarded', 'submitted', 'completed',
];

/** Позиция статуса на каноническом жизненном цикле (fallback: позади всех). */
export function lotStatusIndex(status: LotStatusKind): number {
  return LOT_STATUS_ORDER.indexOf(status);
}

export interface LiveLot {
  id: string;
  status: LotStatusKind;
  reserve: string;
  bestBid: string;
  bidder: string;
  manager: string;
  winner: string;
  deadline: string;
  deadlineTs: number | null;
}

export interface LiveAgent {
  account: string;
  stake: string;
  tasksCompleted: number;
  tasksFailed: number;
  rating: string;
}

export interface HiveBidData {
  mode: 'live' | 'mock';
  rpcUrl: string;
  contractId: string;
  lots: LiveLot[];
  agents: LiveAgent[];
  escrow: string;
  treasury: string;
  burned: string;
  error?: string;
  updatedAt: number;
  connected: boolean;
}

interface NearBid {
  agent: string;
  price: string;
  eta_ms: number;
}

interface NearLot {
  lot_id: string;
  // serde enum: Rework(k) сериализуется объектом {"Rework":k}, не строкой.
  status: string | { Rework?: number } | null;
  manager: string;
  budget: string;
  bids: NearBid[];
  winner: string | null;
  winning_price: string;
  work_deadline_ms: number;
}

interface NearAgent {
  account: string;
  stake: string;
  tasks_completed: number;
  tasks_failed: number;
  rating: string;
}

type LotStatus = 'Open' | 'BidsClosed' | 'Awarded' | 'Submitted' | 'Rework'
  | 'Completed' | 'PartialSettled' | 'Failed' | 'Cancelled' | 'SubmittedLate';

function toLotKind(status: NearLot['status']): LotStatusKind {
  // Объектная форма {"Rework":k} → rework (QODER #421: startsWith на
  // объекте кидал TypeError и ронял всю live-доску в error-fallback).
  if (status !== null && typeof status === 'object') return 'rework';
  const s = String(status ?? '');
  switch (s as LotStatus) {
    case 'Open': return 'open';
    case 'BidsClosed': return 'bids-closed';
    case 'Awarded': return 'awarded';
    case 'Submitted': return 'submitted';
    case 'SubmittedLate': return 'late';
    case 'Completed': return 'completed';
    case 'PartialSettled': return 'partial';
    case 'Failed': return 'failed';
    case 'Cancelled': return 'cancelled';
    default:
      return s.startsWith('Rework') ? 'rework' : 'open';
  }
}

function pickBestBid(lot: NearLot): { bidder: string; price: string } {
  const best = lot.bids.reduce<{ agent: string; price: string } | null>((acc, bid) => {
    const price = BigInt(bid.price);
    return !acc || price < BigInt(acc.price) ? { agent: bid.agent, price: bid.price } : acc;
  }, null);
  return best ? { bidder: best.agent, price: best.price } : { bidder: lot.winner ?? '—', price: '' };
}

function toLiveLot(lot: NearLot): LiveLot {
  const best = pickBestBid(lot);
  return {
    id: lot.lot_id,
    status: toLotKind(lot.status),
    reserve: formatYocto(lot.budget),
    bestBid: best.price ? formatYocto(best.price) : '—',
    bidder: best.bidder,
    manager: lot.manager,
    winner: lot.winner ?? '—',
    deadline: formatEta(lot.work_deadline_ms - Date.now()),
    deadlineTs: lot.work_deadline_ms ?? null,
  };
}

function toLiveAgent(agent: NearAgent): LiveAgent {
  return {
    account: agent.account,
    stake: formatYocto(agent.stake),
    tasksCompleted: agent.tasks_completed,
    tasksFailed: agent.tasks_failed,
    rating: formatYocto(agent.rating),
  };
}

async function view<T>(url: string, contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 1_000_000_000),
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contract,
        method_name: method,
        args_base64: btoa(JSON.stringify(args)),
      },
    }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const data = (await res.json()) as {
    error?: { message?: string };
    result?: { result?: number[] };
  };
  if (data.error) throw new Error(data.error.message ?? 'RPC error');
  const bytes = data.result?.result;
  if (!Array.isArray(bytes)) throw new Error('RPC empty result');
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes))) as T;
}

export async function fetchLiveBoard(rpcUrl?: string, contractId?: string): Promise<HiveBidData> {
  const url = resolveRpcUrl(rpcUrl);
  const contract = resolveContractId(contractId);
  const base: HiveBidData = {
    mode: 'live', rpcUrl: url, contractId: contract,
    lots: [], agents: [], escrow: '—', treasury: '—', burned: '—',
    updatedAt: Date.now(), connected: false,
  };

  try {
    const ids = await view<string[]>(url, contract, 'get_lot_ids');
    const lots = (await Promise.all(
      ids.map((lotId) => view<NearLot | null>(url, contract, 'get_lot', { lot_id: lotId })),
    )).filter((l): l is NearLot => l !== null);

    const accounts = new Set<string>();
    for (const lot of lots) {
      if (lot.manager) accounts.add(lot.manager);
      if (lot.winner) accounts.add(lot.winner);
      for (const bid of lot.bids) accounts.add(bid.agent);
    }
    const agents = (await Promise.all(
      Array.from(accounts).map((account) =>
        view<NearAgent | null>(url, contract, 'get_agent', { account })),
    )).filter((a): a is NearAgent => a !== null).map(toLiveAgent);

    const [escrow, treasury, burned] = await Promise.all([
      view<string>(url, contract, 'get_escrow'),
      view<string>(url, contract, 'get_treasury'),
      view<string>(url, contract, 'get_burned'),
    ]);

    return {
      ...base,
      connected: true,
      lots: lots.map(toLiveLot),
      agents,
      escrow: formatYocto(escrow),
      treasury: formatYocto(treasury),
      burned: formatYocto(burned),
      updatedAt: Date.now(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, error: `RPC недоступен: ${message}` };
  }
}

/** Результат запроса живых рейтингов: ok — API отвечал, ratings — карта. */
export interface RatingsResult {
  ok: boolean;
  ratings: Record<string, AgentRatings>;
}

const RATINGS_TTL_MS = 60_000;
let ratingsCache: { at: number; result: RatingsResult } | null = null;

/**
 * Рейтинги агентов из nexus-core через локальный мост (D:/<repo>\tools\newf_bridge.py).
 * Static export сам не умеет в /api/core — мост проксирует (CORS). GET — read
 * scope без auth (POST score — admin-only, здесь не используется).
 * Кэш на 60 с (разумный полл). Недоступность А не роняет live-доску:
 * ok=false, ratings={} — вызывающий честно маркирует fallback.
 */
export async function fetchCoreRatings(bridgeBase?: string): Promise<RatingsResult> {
  if (ratingsCache && Date.now() - ratingsCache.at < RATINGS_TTL_MS) {
    return ratingsCache.result;
  }
  const base = (bridgeBase || process.env.NEXUS_BRIDGE_BASE || 'http://localhost:8471').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/api/core/ratings`, { cache: 'no-store' });
    if (!res.ok) {
      ratingsCache = { at: Date.now(), result: { ok: false, ratings: {} } };
      return ratingsCache.result;
    }
    const data = (await res.json()) as { ratings?: Record<string, AgentRatings> };
    const ratings = data.ratings ?? {};
    ratingsCache = { at: Date.now(), result: { ok: true, ratings } };
    return ratingsCache.result;
  } catch {
    ratingsCache = { at: Date.now(), result: { ok: false, ratings: {} } };
    return ratingsCache.result;
  }
}
