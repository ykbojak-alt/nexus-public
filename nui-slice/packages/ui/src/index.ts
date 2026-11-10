// Global layers — side-effect imports so every consumer (app + storybook)
// gets them via the barrel: themed :focus-visible ring (required by
// .unstyledTrigger resets) and nx-type-* role utilities (spec §9).
import './accessibility/focus-ring.css';
import './accessibility/scrollbars.css';
import './accessibility/win-chrome.css';
import './typography/type-roles.css';

// theme
export { NexusThemeProvider, useNexusTheme } from './theme/nexus-theme-provider';

// accessibility
export { VisuallyHidden } from './accessibility/visually-hidden';
export { ScrollRegion, type ScrollRegionProps } from './accessibility/scroll-region';
export { List, ListItem, type ListProps, type ListItemProps } from './accessibility/list';
export { Kbd, type KbdProps, type KbdSize } from './typography/kbd/kbd';

// surfaces
export { GlassPanel, type GlassPanelProps } from './surfaces/glass-panel/glass-panel';
export {
  GlassSurface,
} from './surfaces/glass-bars/glass-surface';
export { CapsuleInput } from './surfaces/glass-bars/capsule-input';
export { StatusStrip } from './surfaces/glass-bars/status-strip';
export { Card, type CardProps } from './surfaces/card/card';
export { Section } from './surfaces/section/section';
export { PanelHeader, type PanelHeaderLevel, type PanelHeaderProps } from './panel-header/panel-header';
export { Divider } from './surfaces/divider/divider';
export { Toolbar, ToolbarGroup, ToolbarSeparator, ToolbarSpacer } from './surfaces/toolbar/toolbar';
export { FloatingPanel, type FloatingPanelProps } from './surfaces/floating-panel/floating-panel';
export {
    Table, TableHead, TableBody, TableRow, TableCell, TableHeaderCell,
    type TableProps, type TableRowProps, type TableCellProps, type TableHeaderCellProps
} from './surfaces/table/table';
export { Popover, type PopoverProps } from './surfaces/popover/popover';
export { Tooltip, type TooltipPosition, type TooltipProps } from './surfaces/tooltip/tooltip';
export { Drawer, type DrawerProps } from './surfaces/drawer/drawer';
export { Modal, type ModalProps } from './surfaces/modal/modal';

// actions
export { Button, type ButtonProps } from './actions/button/button';
export { IconButton, type IconButtonProps } from './actions/icon-button/icon-button';
export { SplitButton, type SplitButtonProps } from './actions/split-button/split-button';
export { Chip, type ChipProps } from './actions/chip/chip';
export { ActionMenu, type ActionMenuProps, type ActionMenuItem } from './actions/action-menu/action-menu';
export { CommandTrigger, type CommandTriggerProps } from './actions/command-trigger/command-trigger';

// feedback
export { CompactBlock, type CompactBlockProps } from './compaction/compact-block';
export {
  CompactIndicator,
  type CompactIndicatorProps,
  type CompactIndicatorPattern,
  type CompactState,
} from './compaction/compact-indicator';
export { CompactBadge, type CompactBadgeProps } from './compaction/compact-badge';
export { CompactSummaryRow, type CompactSummaryRowProps } from './compaction/compact-summary-row';
export { StatusBadge, type StatusBadgeProps, type NexusStatus } from './feedback/status-badge/status-badge';
export { TypingIndicator, type TypingIndicatorProps } from './feedback/typing-indicator/typing-indicator';
export { ApprovalRequest, type ApprovalRequestProps, type ApprovalState } from './feedback/approval-request/approval-request';
export { SystemNotice, type NoticeTone } from './feedback/system-notice/system-notice';
export { Toast, ToastRegion, type ToastAction, type ToastData } from './feedback/toast/toast';
export { ProgressBar, type ProgressBarProps } from './feedback/progress-bar/progress-bar';
export { ProgressArc, type ProgressArcProps } from './feedback/progress-arc/progress-arc';
export { Skeleton } from './feedback/skeleton/skeleton';
export { EmptyState } from './feedback/empty-state/empty-state';
export { ErrorState } from './feedback/error-state/error-state';
export { LoadingState } from './feedback/loading-state/loading-state';
export { UnavailableState } from './feedback/unavailable-state/unavailable-state';

// inputs
export { Switch, type SwitchProps } from './inputs/switch/switch';
export { Select, type SelectProps, type SelectOption } from './inputs/select/select';
export { TextField, type TextFieldProps } from './inputs/text-field/text-field';
export { SearchField, type SearchFieldProps } from './inputs/search-field/search-field';
export { TextArea, type TextAreaProps } from './inputs/text-area/text-area';
export { Combobox, type ComboboxProps, type ComboboxOption } from './inputs/combobox/combobox';
export { Listbox, ListboxOption, type ListboxProps, type ListboxOptionProps } from './inputs/listbox/listbox';
export { Checkbox, type CheckboxProps } from './inputs/checkbox/checkbox';
export { RadioGroup, type RadioGroupProps, type RadioOption } from './inputs/radio/radio';
export { Slider, type SliderProps } from './inputs/slider/slider';
export { RangeSlider, type RangeSliderProps } from './inputs/range-slider/range-slider';

// navigation
export { Tabs, type TabsProps, type TabItem } from './navigation/tabs/tabs';
export { TabList, Tab, TabPanel, type TabListProps, type TabProps, type TabPanelProps } from './navigation/tabs/tab-primitives';
export { IconRail, type IconRailProps, type RailSection } from './navigation/icon-rail/icon-rail';
export { PageHeader, type PageHeaderProps } from './navigation/page-header/page-header';
export { CommandPalette, type CommandPaletteProps, type CommandItem } from './navigation/command-palette/command-palette';
export { TopBar } from './navigation/top-bar/top-bar';
export { Sidebar } from './navigation/sidebar/sidebar';
export { NavItem, type NavItemProps } from './navigation/nav-item/nav-item';
export { Breadcrumbs, type Breadcrumb } from './navigation/breadcrumbs/breadcrumbs';
export { Pagination, type PaginationProps } from './navigation/pagination/pagination';

// layout
export { NexusShell, type NexusShellProps } from './layout/nexus-shell';
export { WindowFrame, type WindowFrameProps } from './layout/window-frame';
export { WindowControls, type WindowControlsProps } from './layout/window-controls';
export { ArtPanel, type ArtPanelProps } from './surfaces/art-panel/art-panel';
export { AssistantCard, type AssistantCardProps } from './ai/assistant-card/assistant-card';
export { CommandLayout } from './layout/command-layout';
export { IntelligenceLayout } from './layout/intelligence-layout';
export { StudioLayout } from './layout/studio-layout';

// ai
export { AgentAvatar, type AgentAvatarProps } from './ai/agent-avatar/agent-avatar';
export { AgentBadge } from './ai/agent-badge/agent-badge';
export { AgentStatus } from './ai/agent-status/agent-status';
export { AgentCard, type AgentCardProps, type AgentCardState } from './ai/agent-card/agent-card';
export { AgentIdentity } from './ai/agent-identity/agent-identity';
export { AgentSelector, type AgentSelectorProps } from './ai/agent-selector/agent-selector';
export { AgentHandoff } from './ai/agent-handoff/agent-handoff';
export { AgentPresence, type PresenceEntry } from './ai/agent-presence/agent-presence';
export { ModelBadge } from './ai/model-badge/model-badge';
export { ToolBadge } from './ai/tool-badge/tool-badge';
export { IntegrationBadge } from './ai/integration-badge/integration-badge';
export { RuntimeStatus } from './ai/runtime-status/runtime-status';
export { ConfidenceMeter } from './ai/confidence-meter/confidence-meter';
export { EvidenceStrength, type EvidenceLevel } from './ai/evidence-strength/evidence-strength';
export { MemoryState } from './ai/memory-state/memory-state';
export type { AgentRef, AgentPresenceKind, AgentStatusKind, ConfidenceValue, Freshness } from './ai/types';

// runtime — local-agent-runtime primitives (window launcher, workspace, session, feed)
export { RuntimeLauncher, type RuntimeLauncherProps, type RuntimeWindowState } from './runtime/runtime-launcher/runtime-launcher';
export { WorkspacePicker, type WorkspacePickerProps, type WorkspaceRoot } from './runtime/workspace-picker/workspace-picker';
export { PermissionMode, type PermissionModeProps, PERMISSION_MODE_LABELS } from './runtime/permission-mode/permission-mode';
export { SessionStatus, type SessionStatusProps, SESSION_STATE_LABELS } from './runtime/session-status/session-status';
export { ConnectionStatus, type ConnectionStatusProps, CONNECTION_STATE_LABELS } from './runtime/connection-status/connection-status';
export { ReadinessItem, type ReadinessItemProps } from './runtime/readiness-item/readiness-item';
export { ContextItem, type ContextItemProps } from './runtime/context-item/context-item';
export { EventRow, type EventRowProps } from './runtime/event-row/event-row';
export { FileDiffRow, type FileDiffRowProps } from './runtime/file-diff-row/file-diff-row';
export { SourceLink, type SourceLinkProps } from './runtime/source-link/source-link';
export { PlanSummary, type PlanSummaryProps, type PlanStep } from './runtime/plan-summary/plan-summary';
export { AudioPlayer, type AudioPlayerProps, type AudioTrack } from './runtime/audio-player/audio-player';
export { ProviderEmbed, type ProviderEmbedProps } from './runtime/provider-embed/provider-embed';
export { ServiceCard, type ServiceCardProps, type ServiceAccessMode, type ServiceConnectionState, SERVICE_STATE_LABELS, ACCESS_MODE_LABELS } from './runtime/service-card/service-card';
export { RuntimeClientCatalog, type RuntimeClientCatalogProps, type RuntimeClientEntry, type RuntimeCatalogState, type RuntimeClientGroupBy } from './runtime/client-catalog/client-catalog';
export { QwenClientCard, type QwenClientCardProps, type QwenClientState, type QwenSubsystemKind, type QwenSubsystemState, type QwenSubsystemStatus, QWEN_CLIENT_STATE_LABELS, QWEN_SUBSYSTEM_LABELS, QWEN_SUBSYSTEM_STATE_LABELS } from './runtime/qwen-client-card/qwen-client-card';
export { AgendaRow, type AgendaRowProps, type AgendaDetailState } from './runtime/agenda-row/agenda-row';
export { DocsItem, type DocsItemProps, type DocsItemState } from './runtime/docs-item/docs-item';
export { ProviderSearchResults, type ProviderSearchResultsProps, type SearchResultItem, type ProviderSearchState } from './runtime/provider-search-results/provider-search-results';
export { MessageRow, type MessageRowProps, type MessageDirection, type MessageSendState } from './runtime/message-row/message-row';
export { ThreadRow, type ThreadRowProps } from './runtime/thread-row/thread-row';
export { CommentRow, type CommentRowProps } from './runtime/comment-row/comment-row';
export { Composer, type ComposerProps } from './runtime/composer/composer';
export { JobControl, type JobControlProps } from './runtime/job-control/job-control';
export { RunTrajectory, ToolCallCard, type RunTrajectoryProps, type ToolCallCardProps, type TrajectoryCall, type TrajectoryCallStatus, trajectoryTree } from './runtime/run-trajectory/run-trajectory';
export { ExpandRegion, type ExpandRegionProps, NestedReveal, type NestedRevealProps, StreamingText, type StreamingTextProps, BusyDot, type BusyDotProps, SendFlash, type SendFlashProps, useSendConfirm } from './motion/motion-copilot';
export type {
    WorkspaceRootState, PermissionModeKind, LocalSessionState, ReadinessState,
    RuntimeEventKind, FileDiffState, PlanStepState, AudioTrackState, ProviderEmbedState,
    ProviderConnectionState, GrantLiveness,
} from './runtime/types';
export { maskSecrets, MASKED } from './runtime/mask-secrets';
export {
    grantLiveness, grantDeadlineText, GRANT_LIVENESS_STATUS, GRANT_LIVENESS_LABELS,
    type GrantLivenessInput,
} from './runtime/grant-liveness';

// metrics
export { MetricCard, type MetricCardProps } from './metrics/metric-card/metric-card';
export { MetricStrip } from './metrics/metric-strip/metric-strip';
export { MetricRing, type MetricRingProps } from './metrics/metric-ring/metric-ring';
export { StatusGauge, type HealthLevel } from './metrics/status-gauge/status-gauge';
export { ResourceBar, type ResourceBarProps } from './metrics/resource-bar/resource-bar';
export { Sparkline, type SparklineProps } from './metrics/sparkline/sparkline';

// game — authored-art primitives (fixed across themes, see baseline-policy)
export { ChessPiece, type ChessPieceProps, type ChessPieceType, type ChessPieceColor } from './game/chess-piece/chess-piece';

// dev tooling
export { ReferenceFrame, type ReferenceFrameProps, type ReferenceMode } from './dev/reference-frame/reference-frame';

// charts — owned by Window 4 (ui/src/charts/**); re-exported, not authored here.
export * from './charts';

// agent-chat — набор чата агента (wave-XIV W2): композитор режим+модель,
// дифф-ревью, чекпоинт, использование, #упоминания, вложения, подтверждение.
export { AgentComposer, AGENT_COMPOSER_MODES, type AgentComposerProps, type AgentComposerMode, type AgentComposerModel } from './agent-chat/agent-composer';
export { DiffReviewCard, type DiffReviewCardProps, type DiffReviewFile } from './agent-chat/diff-review-card';
export { CheckpointMarker, type CheckpointMarkerProps, type CheckpointState } from './agent-chat/checkpoint-marker';
export { UsageMeter, type UsageMeterProps } from './agent-chat/usage-meter';
export { FileMention, type FileMentionProps } from './agent-chat/file-mention';
export { AttachmentList, type AttachmentListProps, type AttachmentItem } from './agent-chat/attachment-list';
export { ToolConfirmationCard, type ToolConfirmationCardProps, type ToolConfirmationStatus } from './agent-chat/tool-confirmation-card';
export { StreamText, type StreamTextProps } from './agent-chat/stream-text';
export { SessionRow, type SessionRowProps } from './agent-chat/session-row';
export { DelegationTree, delegationTree, type DelegationTreeProps, type DelegationItem } from './agent-chat/delegation-tree';

// agent-panel (wave-XXV W3): плавающая панель ассистента — капсула / панель /
// чат, drag & resize, keyboard, reduced-motion; состояние не выдумывается.
export {
  AgentPanel,
  type AgentPanelHandle,
  type AgentPanelMessage,
  type AgentPanelMode,
  type AgentPanelPosition,
  type AgentPanelProps,
  type AgentPanelRole,
  type AgentPanelSize,
} from './agent-panel/agent-panel';

// plugins — докинг-панели и менеджер плагинов NEU (wave-XVI W2,
// neu-plugin-panels-spec.md): карточка плагина, шапка вкладок правой
// панели, группы списка, бейджи состояний.
export { PluginCard, type PluginCardProps } from './plugins/plugin-card';
export { PluginStatusBadge, type PluginStatusBadgeProps, type PluginStatus } from './plugins/plugin-status-badge';
export { RightPanelTabBar, type RightPanelTabBarProps, type RightPanelTab, type RightPanelMode } from './plugins/right-panel-tab-bar';
export { PluginGroup, type PluginGroupProps } from './plugins/plugin-group';

// motion — ambient живое движение (visual-3 V4, окно W4): canvas-свечение,
// параллакс, стаггер-появление, пульс. Всё гасится prefers-reduced-motion.
export { AmbientCanvas, type AmbientCanvasProps } from './motion/ambient-canvas';
export { ParallaxLayer, type ParallaxLayerProps } from './motion/parallax-layer';
export { MotionEnter, AmbientPulse, AmbientGlow, type MotionEnterProps, type AmbientPulseProps, type AmbientGlowProps } from './motion/motion-wrappers';
export { staggerDelay } from './motion/motion-helpers';

// Canonical public types for glass, state, theme and token contracts.
export type {
  GlassSurfaceProps,
  GlassVariant,
  GlassTone,
  CapsuleInputProps,
  StatusStripProps,
  LoadingStateProps,
  EmptyStateProps,
  ErrorStateProps,
  UnavailableStateProps,
  CanonicalThemeId,
  NexusThemeId,
  NexusThemeDefinition,
  ResolvedNexusTheme,
  TokenPath,
  NexusThemeProviderProps,
  TokenKey,
  AssistantThemeId,
} from './types';
