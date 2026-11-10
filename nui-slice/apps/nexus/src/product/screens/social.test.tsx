// @vitest-environment jsdom
/** SocialScreen tests — unavailable без seam, рендер mock-данных, approve/reject обновляют статус. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
  usePathname: () => '/social',
  useSearchParams: () => new URLSearchParams(''),
}));

// Profile mock with raeOpToken
const mockProfile = {
  name: 'Test User',
  themeId: 'nexus',
  density: 'standard',
  agentId: 'nexus',
  surfaces: {},
  osNotifications: false,
  uiLevel: 'professional',
  favoritePrompts: [],
  defaultPreset: null,
  defaultModelId: null,
  defaultRunAgent: null,
  voiceSpeakerId: null,
  voiceAutoSpeak: false,
  navCollapsed: false,
  useMemory: true,
  memoryProject: 'ai2',
  fsMode: 'read_only',
  fsRoots: [],
  composerMode: 'agent',
  raeOpToken: 'test-op-token-123',
};

vi.mock('../profile/profile-store', () => ({
  useProfile: () => ({ profile: mockProfile, persisted: true, complete: true, loaded: true }),
}));

// Social seam mock
const getState = vi.fn();
const listQueue = vi.fn();
const listApprovals = vi.fn();
const respondApproval = vi.fn();
const createDraft = vi.fn();
const setMode = vi.fn();

const seams = { social: true };

vi.mock('../data-source', () => {
  const compute = () => ({
    ...(seams.social ? { social: { getState, listQueue, listApprovals, respondApproval, createDraft, setMode } } : {}),
  });
  return {
    getDataSourceKind: () => 'mock',
    getDataSource: compute,
    useDataSource: compute,
  };
});

import { SocialScreen } from './social';

const HUB_STATE = {
  mode: 'stealth',
  agent: {
    operator: 'AGENT-A',
    state: 'drafting',
    currentTask: 'контент-план на неделю',
    subAgents: [
      { key: 'forge', task: 'генерация обложки для X' },
      { key: 'mech', task: 'подбор слотов публикации' },
      { key: 'codex', task: null },
      { key: 'arch', task: 'ретроспектива охвата' },
    ],
  },
  accounts: [
    { network: 'telegram', handle: '@nexus_ops', state: 'connected', followers: 12500, reason: null },
    { network: 'instagram', handle: '@nexus.aios', state: 'connected', followers: 8200, reason: null },
    { network: 'youtube', handle: null, state: 'not-connected', followers: null, reason: 'OAuth не пройден' },
    { network: 'x', handle: '@nexus_aios', state: 'needs-review', followers: 3400, reason: 'scope post.write ждёт app review' },
  ],
};

const QUEUE_POSTS = [
  { id: 'sp-001', network: 'x', text: 'Test draft', media: 'text', status: 'draft', scheduledAt: null, authorAgent: 'forge' },
  { id: 'sp-002', network: 'telegram', text: 'Test scheduled', media: 'image', status: 'scheduled', scheduledAt: new Date(Date.now() + 7200000).toISOString(), authorAgent: 'alice' },
  { id: 'sp-003', network: 'instagram', text: 'Test approval', media: 'image', status: 'pending-approval', scheduledAt: null, authorAgent: 'forge' },
];

const APPROVALS_POSTS = [
  { id: 'sp-004', network: 'x', text: 'Approval test', media: 'text', status: 'pending-approval', scheduledAt: null, authorAgent: 'alice', verified: true, verifyReason: 'проверено модератором' },
  { id: 'sp-005', network: 'instagram', text: 'Approval test 2', media: 'image', status: 'pending-approval', scheduledAt: null, authorAgent: 'forge', verified: false, verifyReason: 'ссылка битая' },
];

const HUB_STATE_OFFLINE = {
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
  source: 'mock-offline',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  seams.social = true;
});

describe('SocialScreen', () => {
  it('renders unavailable when seam absent', async () => {
    seams.social = false;
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByTestId('social-unavailable')).toBeInTheDocument());
  });

  it('renders KPI row with connected networks count', async () => {
    seams.social = true;
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getAllByText('Подключено').length).toBeGreaterThan(0));
    expect(screen.getByText('2 / 4')).toBeInTheDocument();
    expect(screen.getByText('Подключено сетей')).toBeInTheDocument();
  });

  it('marks honest empty state when RAE is offline (source: mock-offline)', async () => {
    getState.mockResolvedValue(HUB_STATE_OFFLINE);
    listQueue.mockResolvedValue([]);
    listApprovals.mockResolvedValue([]);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByTestId('social-source-note')).toBeInTheDocument());
    expect(screen.getByTestId('social-source-note')).toHaveAttribute('data-source', 'mock-offline');
    expect(within(screen.getByTestId('social-source-note')).getByText(/RAE демон недоступен/)).toBeInTheDocument();
    expect(screen.getByText('0 / 0')).toBeInTheDocument();
    expect(screen.getByTestId('social-accounts-empty')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/Очередь недоступна/)).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/Утверждения недоступны/)).toBeInTheDocument());
  });

  it('renders AGENT-A operator panel with sub-agents', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('AGENT-A — оператор соцсетей')).toBeInTheDocument());
    expect(screen.getByText('forge')).toBeInTheDocument();
    expect(screen.getByText('генерация обложки для X')).toBeInTheDocument();
    expect(screen.getByText('mech')).toBeInTheDocument();
    expect(screen.getByText('подбор слотов публикации')).toBeInTheDocument();
    expect(screen.getByText('codex')).toBeInTheDocument();
    expect(screen.getByText('свободен')).toBeInTheDocument();
    expect(screen.getByText('arch')).toBeInTheDocument();
    expect(screen.getByText('ретроспектива охвата')).toBeInTheDocument();
  });

  it('renders 4 network cards with correct state badges and handles', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Telegram')).toBeInTheDocument());
    expect(screen.getByText('@nexus_ops')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText('@nexus.aios')).toBeInTheDocument();
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.getByText('@nexus_aios')).toBeInTheDocument();
  });

  it('renders queue with posts', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Test draft')).toBeInTheDocument());
    expect(screen.getByText('Test scheduled')).toBeInTheDocument();
    expect(screen.getByText('Test approval')).toBeInTheDocument();
  });

  it('renders approvals with approve/reject buttons', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Approval test')).toBeInTheDocument());
    expect(screen.getAllByText('Подтвердить').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Отклонить').length).toBeGreaterThan(0);
  });

  it('approve calls respondApproval and retries listApprovals', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    respondApproval.mockResolvedValue({ ...APPROVALS_POSTS[0], status: 'published' });
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Approval test')).toBeInTheDocument());
    await waitFor(() => {
      // Click first approve button (for sp-004)
      const buttons = screen.getAllByText('Подтвердить');
      buttons[0].click();
    });
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('sp-004', 'approve'));
  });

  it('reject calls respondApproval and retries listApprovals', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    respondApproval.mockResolvedValue({ ...APPROVALS_POSTS[0], status: 'rejected' });
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Approval test')).toBeInTheDocument());
    await waitFor(() => {
      const buttons = screen.getAllByText('Отклонить');
      buttons[0].click();
    });
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('sp-004', 'reject', undefined));
  });

  it('reject с причиной: поле «Причина» + «Отправить» шлёт reason', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    respondApproval.mockResolvedValue({ ...APPROVALS_POSTS[0], status: 'rejected' });
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Approval test')).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole('button', { name: 'Причина' })[0]);
    const input = await screen.findByLabelText('Причина отклонения');
    fireEvent.change(input, { target: { value: 'дубликат' } });
    const submit = await screen.findByText('Отправить');
    fireEvent.click(submit);
    await waitFor(() => expect(respondApproval).toHaveBeenCalledWith('sp-004', 'reject', 'дубликат'));
  });

  it('verify-бейджи: verified=true → VERIFIED с reason-tooltip, verified=false → NOT VERIFIED', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText('Approval test')).toBeInTheDocument());
    const verifiedBadge = screen.getByTitle('проверено модератором');
    expect(verifiedBadge.textContent).toContain('VERIFIED');
    const notVerifiedBadge = screen.getByTitle('ссылка битая');
    expect(notVerifiedBadge.textContent).toContain('NOT VERIFIED');
  });

  it('длинный text обрезается до 280 символов с ellipsis', async () => {
    const longText = 'А'.repeat(300);
    listQueue.mockResolvedValue([
      { id: 'sp-long', network: 'x', text: longText, media: 'text', status: 'draft', scheduledAt: null, authorAgent: 'forge' },
    ]);
    getState.mockResolvedValue(HUB_STATE);
    listApprovals.mockResolvedValue([]);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText(`${'А'.repeat(280)}…`)).toBeTruthy());
    expect(screen.queryByText(longText)).toBeNull();
  });

  it('shows mode switcher (stealth/open)', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getAllByText('stealth (cookie-сессия)').length).toBeGreaterThan(0));
    expect(screen.getAllByText('open API').length).toBeGreaterThan(0);
  });

  it('mock badge visible in header', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText(/· mock/)).toBeInTheDocument());
  });

  it('disclaimer mentions AGENT-A zone, approval gate, stealth/open', async () => {
    getState.mockResolvedValue(HUB_STATE);
    listQueue.mockResolvedValue(QUEUE_POSTS);
    listApprovals.mockResolvedValue(APPROVALS_POSTS);
    render(<SocialScreen />);
    await waitFor(() => expect(screen.getByText(/зона A\.L\.I\.C\.E\./)).toBeInTheDocument());
    expect(screen.getByText(/approval-гейт/)).toBeInTheDocument();
    expect(screen.getByText(/stealth[\s\S]*open API/)).toBeInTheDocument();
    expect(screen.getByText(/Cookies:[\s\S]*user-supplied/)).toBeInTheDocument();
  });
});