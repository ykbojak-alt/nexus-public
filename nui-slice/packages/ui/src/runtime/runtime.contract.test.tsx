import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  RuntimeLauncher, WorkspacePicker, PermissionMode, SessionStatus, ConnectionStatus, ReadinessItem,
  ContextItem, EventRow, FileDiffRow, SourceLink, PlanSummary, AudioPlayer, ProviderEmbed,
  ServiceCard, AgendaRow, DocsItem, ProviderSearchResults,
  MessageRow, ThreadRow, CommentRow, Composer, JobControl,
} from '../index';

describe('RuntimeLauncher', () => {
  it('renders lifecycle states and focuses an open window', async () => {
    const onOpen = vi.fn();
    render(<RuntimeLauncher name="Telegram" state="open" onOpen={onOpen} />);
    await userEvent.click(screen.getByRole('button', { name: 'Focus' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('runtime-launcher')).toHaveAttribute('data-state', 'open');
  });

  it('offers an external-browser fallback on unavailable without account claims', () => {
    render(<RuntimeLauncher name="Instagram" state="unavailable" reason="WebView blocked" onOpenExternal={() => { }} />);
    expect(screen.getByText('WebView blocked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open in browser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
  });

  it('disables action while opening', () => {
    render(<RuntimeLauncher name="Telegram" state="opening" onOpen={() => { }} />);
    expect(screen.getByRole('button', { name: 'Open' })).toBeDisabled();
  });
});

describe('WorkspacePicker', () => {
  it('shows the ungranted state honestly', () => {
    render(<WorkspacePicker onPick={() => { }} />);
    expect(screen.getByText(/cannot see local files/i)).toBeInTheDocument();
  });

  it('renders granted and revoked roots with remove action', async () => {
    const onRemove = vi.fn();
    render(<WorkspacePicker onRemove={onRemove}
      roots={[{ path: '/work/a' }, { path: '/work/b', state: 'revoked' }]} />);
    expect(screen.getByText('/work/a')).toBeInTheDocument();
    expect(screen.getByText('revoked')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove /work/a' }));
    expect(onRemove).toHaveBeenCalledWith('/work/a');
  });
});

describe('PermissionMode + SessionStatus + ReadinessItem', () => {
  it('renders the three contract modes with descriptions', () => {
    render(<PermissionMode mode="approve-each" showDescription />);
    expect(screen.getByText('Approve each action')).toBeInTheDocument();
    expect(screen.getByText(/before every write/i)).toBeInTheDocument();
  });

  it('renders session lifecycle including paused', () => {
    render(<SessionStatus state="paused" />);
    expect(screen.getByTestId('session-status')).toHaveTextContent('Paused');
  });

  it('shows unknown probes as unknown, not ready', () => {
    render(<ReadinessItem name="Local worker" state="unknown" />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});

describe('ConnectionStatus (provider adapter lifecycle)', () => {
  it('renders the verbatim adapter vocabulary with canonical labels', () => {
    render(<ConnectionStatus state="reconnecting" />);
    expect(screen.getByTestId('connection-status')).toHaveTextContent('Reconnecting');
  });

  it('unavailable/locked are warnings, never implied connected', () => {
    render(<ConnectionStatus state="unavailable" label="Недоступен — нет TDLib" />);
    const el = screen.getByTestId('connection-status');
    expect(el).toHaveAttribute('data-status', 'warning');
    expect(el).toHaveTextContent('Недоступен — нет TDLib');
  });
});

describe('feed + diff + source + plan', () => {
  it('EventRow renders kind, actor and source', () => {
    render(<EventRow kind="command" time="12:04" actor="executor" source="host">ran pytest</EventRow>);
    expect(screen.getByText('ran pytest')).toBeInTheDocument();
    expect(screen.getByText('executor')).toBeInTheDocument();
    expect(screen.getByText('host')).toBeInTheDocument();
  });

  it('EventRow carries a filter level for Streaming Logs (default info stays clean)', () => {
    const { rerender } = render(<EventRow kind="model_call" level="error">boom</EventRow>);
    expect(screen.getByTestId('event-row')).toHaveAttribute('data-level', 'error');
    rerender(<EventRow kind="model_call">fine</EventRow>);
    expect(screen.getByTestId('event-row')).not.toHaveAttribute('data-level');
  });

  it('FileDiffRow shows counts and review actions while pending', async () => {
    const onAccept = vi.fn();
    render(<FileDiffRow path="src/a.ts" additions={4} deletions={2} onAccept={onAccept} onReject={() => { }} onRestore={() => { }} />);
    expect(screen.getByText('+4')).toBeInTheDocument();
    expect(screen.getByText('−2')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Принять' }));
    expect(onAccept).toHaveBeenCalled();
  });

  it('SourceLink external anchors get safe rel/target', () => {
    render(<SourceLink label="contract.md" href="https://example.com" external source="example.com" />);
    const a = screen.getByRole('link');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(a).toHaveAttribute('target', '_blank');
  });

  it('SourceLink without href or onClick is a non-interactive label', () => {
    render(<SourceLink label="local-file.txt" source="workspace" />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('local-file.txt').closest('span')).toBeInTheDocument();
  });

  it('SourceLink disabled state never exposes a live href or keyboard action', async () => {
    const onClick = vi.fn();
    render(<SourceLink label="недоступный источник" href="/local" disabled onClick={onClick} />);
    const el = screen.getByTestId('source-link');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveAttribute('aria-disabled', 'true');
    expect(el).toHaveAttribute('data-state', 'disabled');
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    await userEvent.click(el);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('PlanSummary reports honest progress', () => {
    render(<PlanSummary title="Plan" goal="Fix tests" steps={[
      { id: '1', label: 'Read files', state: 'done' },
      { id: '2', label: 'Run tests', state: 'running' },
    ]} />);
    expect(screen.getByText('1 of 2 steps done')).toBeInTheDocument();
    expect(screen.getByText('running')).toBeInTheDocument();
  });
});

describe('JobControl (Runtime console)', () => {
  it('shows progress and fires pause/cancel only within capabilities', async () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    render(<JobControl label="run-42" status="executing" statusLabel="В работе"
      progress={64} canPause canCancel onPause={onPause} onCancel={onCancel} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '64');
    await userEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(onPause).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Стоп' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('null progress is honest text, not 0 — and terminal status disables controls', () => {
    render(<JobControl label="run-7" status="complete" canPause canCancel
      onPause={() => { }} onCancel={() => { }} />);
    expect(screen.getByText('прогресс не сообщается')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Стоп' })).toBeDisabled();
  });

  it('without canPause the pause control stays disabled with a reason', () => {
    render(<JobControl label="run-9" status="executing" progress={10} onPause={() => { }} />);
    const pause = screen.getByRole('button', { name: 'Пауза' });
    expect(pause).toBeDisabled();
    expect(pause).toHaveAttribute('title', expect.stringContaining('недоступн'));
  });

  it('paused run offers resume instead of hiding mechanics', () => {
    const onResume = vi.fn();
    render(<JobControl label="run-5" status="paused" progress={30} paused
      onResume={onResume} />);
    const resume = screen.getByRole('button', { name: 'Продолжить' });
    expect(resume).toBeEnabled();
  });
});

describe('AudioPlayer', () => {
  it('exposes contract controls with accessible names', () => {
    render(<AudioPlayer queue={[{ id: 'a', name: 'song.mp3', state: 'playing' }]} currentId="a"
      playing onTogglePlay={() => { }} onPrev={() => { }} onNext={() => { }} onSeek={() => { }} onVolume={() => { }} onToggleMute={() => { }} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous track' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next track' })).toBeInTheDocument();
    // Accessible name, not label textContent: the Slider renders its live
    // value inside an aria-hidden span, so 'Seek' must resolve via accName.
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mute' })).toBeInTheDocument();
  });

  it('shows unsupported state and reason without fake progress', () => {
    render(<AudioPlayer queue={[{ id: 'a', name: 'clip.wma', state: 'unsupported', reason: 'Codec not supported by this WebView' }]}
      currentId="a" onTogglePlay={() => { }} />);
    expect(screen.getByText('Codec not supported by this WebView')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });
});

describe('ProviderEmbed', () => {
  it('renders provider name and children when ready', () => {
    render(<ProviderEmbed provider="YouTube" state="ready"><div data-testid="frame" /></ProviderEmbed>);
    expect(screen.getByText('YouTube')).toBeInTheDocument();
    expect(screen.getByTestId('frame')).toBeInTheDocument();
  });

  it('ServiceCard separates access mode from connection state and toggles actions', () => {
    const { rerender } = render(<ServiceCard name="Google Drive" mode="api" state="not-connected" onConnect={() => { }} />);
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Подключить' })).toBeInTheDocument();
    rerender(<ServiceCard name="Google Drive" mode="api" state="read-only" scopes={['drive.file']} onDisconnect={() => { }} />);
    expect(screen.getByText('Только чтение')).toBeInTheDocument();
    expect(screen.getByText('drive.file')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Отключить здесь' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Подключить' })).not.toBeInTheDocument();
  });

  it('ServiceCard disconnect scope states local vs remote revoke', () => {
    const { rerender } = render(<ServiceCard name="Google Drive" mode="api" state="connected" onDisconnect={() => { }} />);
    expect(screen.getByRole('button', { name: 'Отключить здесь' })).toBeInTheDocument();
    rerender(<ServiceCard name="Google Drive" mode="api" state="connected" onDisconnect={() => { }} disconnectScope="remote" />);
    expect(screen.getByRole('button', { name: 'Отключить и отозвать доступ' })).toBeInTheDocument();
  });

  it('ServiceCard marks mock state honestly', () => {
    render(<ServiceCard name="Hiro VPN" mode="native-app" state="mock" />);
    expect(screen.getByTestId('service-card')).toHaveAttribute('data-state', 'mock');
    expect(screen.getByText('Макет')).toBeInTheDocument();
  });

  it('AgendaRow marks private/unknown details without fabricating', () => {
    render(<><AgendaRow time="12:00" title="Busy" details="private" source="Work" />
      <AgendaRow time="13:00" title="Standup" details="unknown" /></>);
    expect(screen.getByText('Private')).toBeInTheDocument();
    expect(screen.getByText('Details unavailable')).toBeInTheDocument();
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('DocsItem exposes pick/preview/save and blocks implicit confirm-save', () => {
    render(<DocsItem name="spec.md" state="confirm-save" onSave={() => { }} onPreview={() => { }} />);
    expect(screen.getByText('Save requires confirmation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeInTheDocument();
  });

  it('ProviderSearchResults names the source and selects rows', async () => {
    const onSelect = vi.fn();
    render(<ProviderSearchResults source="YouTube Data API" origin="live"
      items={[{ id: 'v1', title: 'Video one', meta: 'Channel · 2026-10-01' }]}
      onSelect={onSelect} />);
    expect(screen.getByText(/Источник: YouTube Data API/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Video one/ }));
    expect(onSelect).toHaveBeenCalledWith('v1');
  });

  it('ProviderSearchResults labels mock origin and never fabricates on error', () => {
    const { rerender } = render(<ProviderSearchResults source="YouTube Data API" origin="mock" state="error" reason="Quota exceeded" />);
    expect(screen.getByText(/демонстрационные данные/)).toBeInTheDocument();
    expect(screen.getByText('Quota exceeded')).toBeInTheDocument();
    rerender(<ProviderSearchResults source="YouTube Data API" state="unavailable" />);
    expect(screen.getByText('Поиск недоступен')).toBeInTheDocument();
  });

  it('replaces the frame with an honest fallback + external action on blocked', () => {
    render(<ProviderEmbed provider="Yandex Music" state="blocked" reason="Embed refused by provider"
      onOpenExternal={() => { }}><div data-testid="frame" /></ProviderEmbed>);
    expect(screen.queryByTestId('frame')).not.toBeInTheDocument();
    expect(screen.getByText('Embed refused by provider')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Open Yandex Music in browser/i })).toBeInTheDocument();
  });
});

describe('messaging primitives (chat/comment/composer)', () => {
  it('MessageRow renders text verbatim and shows send state only when supplied', () => {
    const { rerender } = render(<MessageRow text="Привет" direction="incoming" meta="12:30" />);
    expect(screen.getByText('Привет')).toBeInTheDocument();
    expect(screen.getByText('12:30')).toBeInTheDocument();
    expect(screen.getByTestId('message-row')).toHaveAttribute('data-direction', 'incoming');
    rerender(<MessageRow text="Ответ" direction="outgoing" state="failed" failedReason="Rate limited" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Rate limited');
    rerender(<MessageRow text="Без статуса" direction="outgoing" />);
    expect(screen.getByTestId('message-row')).not.toHaveAttribute('data-state');
  });

  it('ThreadRow is a real button only when selectable, keeps preview verbatim', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<ThreadRow title="General" preview="last: ок" unread={3} note="read-only" onSelect={onSelect} />);
    const row = screen.getByRole('button', { name: /General/ });
    await userEvent.click(row);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('read-only')).toBeInTheDocument();
    rerender(<ThreadRow title="Static" />);
    expect(screen.queryByRole('button', { name: /Static/ })).not.toBeInTheDocument();
    expect(screen.getByTestId('thread-row')).not.toHaveAttribute('data-selected');
  });

  it('truncated verbatim strings expose the full text via title', () => {
    const longTitle = 'Очень длинное название треда которое не помещается в строку';
    render(<ThreadRow title={longTitle} preview="короткий" />);
    expect(screen.getByText(longTitle)).toHaveAttribute('title', longTitle);
  });

  it('CommentRow renders author + text verbatim', () => {
    render(<CommentRow text="Nice shot" author="@handle" meta="2h" />);
    expect(screen.getByText('Nice shot')).toBeInTheDocument();
    expect(screen.getByText('@handle · 2h')).toBeInTheDocument();
  });

  it('Composer submits only on explicit user action and blocks empty/pending', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <Composer value="" onChange={() => { }} onSubmit={onSubmit} inputLabel="Текст сообщения" />,
    );
    const input = screen.getByRole('textbox', { name: 'Текст сообщения' });
    const submit = screen.getByRole('button', { name: 'Отправить' });
    expect(submit).toBeDisabled();
    rerender(<Composer value="привет" onChange={() => { }} onSubmit={onSubmit} inputLabel="Текст сообщения" />);
    expect(submit).toBeEnabled();
    await userEvent.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
    rerender(<Composer value="x" onChange={() => { }} onSubmit={onSubmit} inputLabel="Текст сообщения" pending />);
    expect(submit).toBeDisabled();
    await userEvent.type(input, '{Enter}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
