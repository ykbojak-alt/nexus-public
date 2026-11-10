import type { ReactNode } from 'react';

/** Data loading state — honest empty/error, never fabricated values. */
export type AliceHomeDataState = 'ready' | 'loading' | 'error' | 'stale' | 'empty';

/** Runtime core semantic state (contract §11). */
export type AliceHomeCoreState =
  | 'healthy' | 'attention' | 'thinking' | 'syncing'
  | 'degraded' | 'critical' | 'offline';

/** Composer lifecycle (contract §10). */
export type AliceHomeComposerState =
  | 'idle' | 'focused' | 'typing' | 'queued'
  | 'executing' | 'success' | 'error' | 'disabled';

export interface AliceHomeCapability {
  id: string;
  label: string;
  /** Custom mark; when absent a built-in geometric SVG is used by id. */
  icon?: ReactNode;
  state?: 'default' | 'active' | 'disabled';
  /** Disabled reason / tooltip. */
  hint?: string;
}

export interface AliceHomeCommandMode {
  id: string;
  label: string;
}

export interface AliceHomeComposerTool {
  id: string;
  label: string;
  disabled?: boolean;
  /** Why the tool is unavailable — shown verbatim, never invented. */
  reason?: string;
  onSelect?: () => void;
}

export interface AliceHomeResourceMeter {
  id: string;
  label: string;
  /** 0..100; null renders an honest "нет данных" through ResourceBar. */
  value: number | null;
}

export interface AliceHomeTimelineItem {
  id: string;
  title: string;
  /** Pre-formatted display timestamp (right-aligned). */
  timestamp: string;
  status?: 'online' | 'thinking' | 'syncing' | 'executing' | 'paused' | 'offline' | 'success' | 'warning' | 'error';
}

export interface AliceHomePortrait {
  src: string;
  alt: string;
}

export interface AliceHeroProps {
  /** Uppercase eyebrow line, e.g. «ПЕРСОНАЛЬНЫЙ ИНТЕЛЛЕКТ». */
  eyebrow?: string;
  title?: string;
  description?: string;
  /** Display-serif statement line (e.g. the motto). */
  statement?: string;
  /** Transparent ALICE figure asset; absent → no portrait, no fabrication. */
  portrait?: AliceHomePortrait;
  /** Right-aligned verb column (decorative axis; real actions live in the rail). */
  signature?: readonly { id: string; label: string }[];
  /** Extra content (echo, greeting) from the host screen. */
  children?: ReactNode;
}

export interface AliceHomeCapabilityRailProps {
  capabilities: readonly AliceHomeCapability[];
  onSelect?: (capability: AliceHomeCapability) => void;
}

export interface AliceHomeComposerVoice {
  enabled?: boolean;
  /** Currently speaking/recording → toggle stops. */
  active?: boolean;
  label?: string;
  /** Disabled reason, shown verbatim. */
  reason?: string;
  onToggle?: () => void;
}

export interface AliceHomeComposerAttachment {
  enabled?: boolean;
  /** Disabled reason, shown verbatim. */
  reason?: string;
  onSelect?: () => void;
}

export interface AliceHomeComposerProps {
  agent: string;
  /** Active mode id; static label when `modes` is not provided. */
  mode?: string;
  modes?: readonly AliceHomeCommandMode[];
  onModeChange?: (mode: string) => void;
  value: string;
  onValueChange: (value: string) => void;
  /** The composer only invokes callbacks; it never performs requests. */
  onSubmit: () => void;
  /** Stable textarea id for outer handoff contracts (e.g. draft hydration). */
  inputId?: string;
  state?: AliceHomeComposerState;
  voice?: AliceHomeComposerVoice;
  attachment?: AliceHomeComposerAttachment;
  tools?: readonly AliceHomeComposerTool[];
  toolsSummary?: string;
  submitLabel?: string;
  placeholder?: string;
  /** Host-provided failure text, verbatim. */
  error?: string | null;
}

export interface AliceHomeSystemStatusProps {
  title?: string;
  state?: AliceHomeDataState;
  core?: AliceHomeCoreState;
  /** Host-controlled dismissal of the whole card. */
  hidden?: boolean;
  /** Overrides the built-in core-state label; pass host wording verbatim. */
  statusLabel?: string;
  activeRuns?: number | null;
  latencyMs?: number | null;
  /** Real host load 0..1 (CPU share) — steers the core sphere's speed. */
  load?: number | null;
  /** RAM share 0..1 — steers the core sphere's halo. */
  loadB?: number | null;
  /** Active worker processes on the host — the core sphere draws one orbiting
   *  satellite per process (1:1). `null` (host silent) draws none, so the model
   *  never implies a count it does not have. */
  processes?: number | null;
  meters?: readonly AliceHomeResourceMeter[];
  /** Fact rows become links only when the host provides navigation. */
  onFactSelect?: (fact: 'activeRuns' | 'latency') => void;
  /** Renders the header dismiss control and hides the card. */
  onClose?: () => void;
  actionLabel?: string;
  onAction?: () => void;
}

/** Одна светящаяся гряда в «Потоке активности» — реальный ряд процентов
 *  (0–100), накопленный из опросов метрик хоста. */
export interface ActivityRidgeSeries {
  id: 'cpu' | 'ram' | 'disk' | (string & {});
  label: string;
  data: readonly number[];
}

/** Separate rail card under the status panel (contract ref: «Поток активности»). */
export interface AliceHomeActivityPanelProps {
  title?: string;
  state?: AliceHomeDataState;
  /** Activity samples; fewer than 2 or null → honest empty note. */
  data?: readonly number[] | null;
  /** Три реальных ряда → светящиеся гряды по референсу; меньше двух рядов →
   *  фолбэк одиночным Sparkline из `data`. */
  series?: readonly ActivityRidgeSeries[] | null;
  label?: string;
  emptyBody?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export interface AliceHomeTodayTimelineProps {
  title?: string;
  state?: AliceHomeDataState;
  items?: readonly AliceHomeTimelineItem[];
  emptyTitle?: string;
  emptyBody?: string;
  /** Header menu control — re-reads the host event list. */
  onRefresh?: () => void;
  /** Retry shown only for the failed state (host run list unavailable). */
  actionLabel?: string;
  onAction?: () => void;
}

export interface AliceHomeTemplateProps {
  /** Main workspace content (hero + rail + composer data/callbacks). */
  hero?: AliceHeroProps;
  capabilities?: readonly AliceHomeCapability[];
  onCapabilitySelect?: (capability: AliceHomeCapability) => void;
  /** Composer props; when absent the surface renders disabled, not fake. */
  composer?: AliceHomeComposerProps;
  /** Right rail; both sections degrade to honest empty states. */
  systemStatus?: AliceHomeSystemStatusProps;
  /** Separate activity card between status and today. */
  activity?: AliceHomeActivityPanelProps;
  today?: AliceHomeTodayTimelineProps;
  /** Approved environment plate — never the composited reference screenshot. */
  environmentImageSrc?: string;
  environmentImageAlt?: string;
  workspaceLabel?: string;
  railLabel?: string;
  className?: string;
}
