import { useId, type FormEvent } from 'react';
import { GlassPanel, ResourceBar, Sparkline } from '@nexus/ui';
import { CoreSphere } from './core-sphere';
import { ActivityRidges } from './activity-ridges';
import styles from './alice-home-template.module.css';
import type {
  AliceHomeActivityPanelProps,
  AliceHomeCapabilityRailProps,
  AliceHomeComposerProps,
  AliceHomeComposerTool,
  AliceHomeCoreState,
  AliceHomeSystemStatusProps,
  AliceHomeTemplateProps,
  AliceHomeTimelineItem,
  AliceHomeTodayTimelineProps,
  AliceHeroProps,
} from './types';

const CORE_LABELS: Record<AliceHomeCoreState, string> = {
  healthy: 'Система в норме',
  attention: 'Требует внимания',
  thinking: 'Обрабатывает запрос',
  syncing: 'Синхронизация',
  degraded: 'Деградация сервиса',
  critical: 'Критическое состояние',
  offline: 'Рантайм не в сети',
};

/** Built-in geometric marks for the six contract capability ids (SVG only). */
function CapabilityGlyph({ id }: { id: string }) {
  switch (id) {
    case 'research':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.2" /><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" /></svg>
      );
    case 'analyze':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-8M22 20H2" /></svg>
      );
    case 'plan':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5" /><path d="M3.5 10h17M8 2.8V6.4M16 2.8V6.4" /></svg>
      );
    case 'create':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4.5 7.4v9.2L12 21l7.5-4.4V7.4L12 3Z" /><path d="M4.5 7.4 12 11.8l7.5-4.4M12 11.8V21" /></svg>
      );
    case 'automate':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.6" /><circle cx="18" cy="6" r="2.6" /><circle cx="12" cy="18" r="2.6" /><path d="M8.4 6h7.2M7.4 8.2l3.1 7.2M16.6 8.2l-3.1 7.2" /></svg>
      );
    case 'observe':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M3.4 10.6c2.4 1.6 5.3 2.4 8.6 2.4s6.2-.8 8.6-2.4M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></svg>
      );
    default:
      return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 20 12 12 20 4 12Z" /></svg>;
  }
}

export function AliceHero({
  eyebrow = 'Персональный интеллект',
  title = 'AGENT-A',
  description,
  statement,
  portrait,
  signature,
  children,
}: AliceHeroProps) {
  return (
    <section className={styles.hero} aria-label={title} data-testid="alice-hero">
      {portrait != null && (
        <img className={styles.heroPortrait} src={portrait.src} alt={portrait.alt} draggable={false} />
      )}
      <div className={styles.heroContent}>
        <p className={styles.heroEyebrow}>{eyebrow}</p>
        <h1 className={styles.heroTitle}>{title}</h1>
        {description != null && <p className={styles.heroDescription}>{description}</p>}
        {statement != null && <p className={styles.heroStatement}>{statement}</p>}
        {children}
      </div>
      {signature != null && signature.length > 0 && (
        <ul className={styles.heroSignature} aria-hidden="true">
          {signature.map((item) => <li key={item.id}>{item.label}</li>)}
        </ul>
      )}
    </section>
  );
}

export function CapabilityRail({ capabilities, onSelect }: AliceHomeCapabilityRailProps) {
  if (capabilities.length === 0) return null;
  return (
    <div className={styles.capabilityRail} role="group" aria-label="Возможности">
      {capabilities.map((cap) => (
        <button
          key={cap.id}
          type="button"
          className={styles.capability}
          data-state={cap.state ?? 'default'}
          disabled={cap.state === 'disabled'}
          title={cap.hint}
          onClick={() => onSelect?.(cap)}
        >
          <span className={styles.capabilityIcon}>{cap.icon ?? <CapabilityGlyph id={cap.id} />}</span>
          <span className={styles.capabilityLabel}>{cap.label}</span>
        </button>
      ))}
    </div>
  );
}

function ComposerTool({ tool }: { tool: AliceHomeComposerTool }) {
  if (tool.disabled || tool.onSelect == null) {
    return (
      <span className={styles.tool} aria-disabled="true" title={tool.reason}>
        {tool.label}{tool.reason != null ? ' · нет данных' : ''}
      </span>
    );
  }
  return (
    <button type="button" className={styles.tool} title={tool.reason} onClick={tool.onSelect}>
      {tool.label}
    </button>
  );
}

function PaperclipGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 11.5 12.5 20a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9" />
    </svg>
  );
}

function SpeakerGlyph({ active }: { active: boolean }) {
  return active ? (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="8" y="5" width="3" height="14" rx="1" />
      <rect x="13" y="5" width="3" height="14" rx="1" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.5L13 5.5v13l-5.5-4H4Z" />
      <path d="M16.5 9a4.2 4.2 0 0 1 0 6M19 6.5a7.6 7.6 0 0 1 0 11" />
    </svg>
  );
}

function SelectChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function DotsGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="6" cy="12" r="1.4" />
      <circle cx="12" cy="12" r="1.4" />
      <circle cx="18" cy="12" r="1.4" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

export function CommandComposer({
  agent,
  mode,
  modes,
  onModeChange,
  value,
  onValueChange,
  onSubmit,
  inputId: inputIdProp,
  state = 'idle',
  voice,
  attachment,
  tools,
  toolsSummary = 'Инструменты, шаблоны и возможности',
  submitLabel = 'Запустить задачу',
  placeholder = 'С чего начнём? Опишите задачу…',
  error,
}: AliceHomeComposerProps) {
  const generatedInputId = useId();
  const inputId = inputIdProp ?? generatedInputId;
  const disabled = state === 'disabled' || state === 'executing';
  const canSubmit = value.trim() !== '' && !disabled;
  const attachDisabled = disabled || attachment?.enabled === false || attachment?.onSelect == null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (canSubmit) onSubmit();
  };
  return (
    <GlassPanel className={styles.composer} data-state={state} data-testid="command-composer">
      <form className={styles.composerForm} onSubmit={submit}>
        <label className={styles.visuallyHidden} htmlFor={inputId}>Опишите задачу для {agent}</label>
        <div className={styles.composerField}>
          <textarea
            id={inputId}
            className={styles.composerInput}
            value={value}
            placeholder={placeholder}
            rows={3}
            disabled={disabled}
            data-state={state}
            onChange={(e) => onValueChange(e.target.value)}
          />
          {attachment != null && (
            <button
              type="button"
              className={styles.attachButton}
              disabled={attachDisabled}
              title={attachment.reason}
              aria-label={attachment.reason ?? 'Прикрепить файл'}
              onClick={attachment.onSelect}
            >
              <PaperclipGlyph />
            </button>
          )}
        </div>
        <div className={styles.composerFooter}>
          {modes != null && modes.length > 0 ? (
            <div className={styles.modeGroup} role="group" aria-label="Режим">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={styles.modeChip}
                  data-active={mode === m.id || undefined}
                  disabled={disabled}
                  aria-pressed={mode === m.id}
                  onClick={() => onModeChange?.(m.id)}
                >
                  {m.label}
                </button>
              ))}
            </div>
          ) : mode != null ? (
            <span className={styles.modeStatic}>{mode}</span>
          ) : null}
          <span className={styles.agentSelect} title="Агента выбирает подключённый рантайм">
            <span>Агент: {agent}</span>
            <SelectChevronGlyph />
          </span>
          {voice != null && (
            <button
              type="button"
              className={styles.voiceButton}
              disabled={voice.enabled === false || disabled}
              title={voice.reason}
              aria-label={voice.active ? 'Остановить голосовой вывод' : (voice.label ?? 'Слушать ответ')}
              aria-pressed={voice.active === true}
              onClick={voice.onToggle}
            >
              <SpeakerGlyph active={voice.active === true} />
              {voice.active ? 'Остановить' : (voice.label ?? 'Слушать ответ')}
            </button>
          )}
          <button type="submit" className={styles.submit} disabled={!canSubmit}>
            {state === 'executing' ? 'Запускаю…' : submitLabel}
            <span aria-hidden="true"> →</span>
          </button>
        </div>
      </form>
      {error != null && <p className={styles.composerError} role="alert">{error}</p>}
      {tools != null && tools.length > 0 && (
        <details className={styles.composerTools}>
          <summary>
            <span className={styles.toolsChevron} aria-hidden="true">›</span>
            <span>{toolsSummary}</span>
            <span className={styles.toolsChevron} aria-hidden="true">›</span>
          </summary>
          <div className={styles.toolRow} role="group" aria-label={toolsSummary}>
            {tools.map((t) => <ComposerTool key={t.id} tool={t} />)}
          </div>
        </details>
      )}
    </GlassPanel>
  );
}

export function SystemStatusPanel({
  title = 'Состояние системы',
  state = 'ready',
  core = 'offline',
  hidden = false,
  statusLabel,
  activeRuns,
  latencyMs,
  load = null,
  loadB = null,
  processes = null,
  meters = [],
  onFactSelect,
  onClose,
  actionLabel,
  onAction,
}: AliceHomeSystemStatusProps) {
  const ready = state === 'ready' || state === 'stale';
  if (hidden) return null;
  return (
    <GlassPanel className={styles.statusPanel} data-state={state} data-testid="system-status-panel">
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {onClose != null && (
          <button
            type="button"
            className={styles.panelIconButton}
            aria-label="Скрыть состояние системы"
            title="Скрыть"
            onClick={onClose}
          >
            <CloseGlyph />
          </button>
        )}
      </header>
      {state === 'loading' && <p className={styles.muted} role="status">Получаю состояние…</p>}
      {state === 'error' && <p className={styles.muted} role="alert">Данные о состоянии недоступны.</p>}
      {state === 'empty' && <p className={styles.muted}>Состояние не запрошено.</p>}
      {/* CoreSphere always renders — offline state when not ready, so the
          sphere is telemetry, not a hidden decoration. */}
      <span className={styles.coreMark} data-state={core}>
        <CoreSphere
          state={core}
          load={ready ? load : null}
          loadB={ready ? loadB : null}
          processes={ready ? processes : null}
        />
      </span>
      <p className={styles.coreStatus} data-state={core}>{statusLabel ?? CORE_LABELS[core]}</p>
      {ready && (
        <>
          <dl className={styles.facts}>
            <div className={styles.factRow}>
              <dt>Активных прогонов</dt>
              <dd>
                {onFactSelect != null ? (
                  <button type="button" className={styles.factAction} onClick={() => onFactSelect('activeRuns')}>
                    {activeRuns != null ? activeRuns : 'нет данных'}
                    <ChevronGlyph />
                  </button>
                ) : (activeRuns != null ? activeRuns : 'нет данных')}
              </dd>
            </div>
            <div className={styles.factRow}>
              <dt>Отклик метрик</dt>
              <dd>
                {onFactSelect != null ? (
                  <button type="button" className={styles.factAction} onClick={() => onFactSelect('latency')}>
                    {latencyMs != null ? `${latencyMs} мс` : 'нет данных'}
                    <ChevronGlyph />
                  </button>
                ) : (latencyMs != null ? `${latencyMs} мс` : 'нет данных')}
              </dd>
            </div>
          </dl>
          {meters.length > 0 && (
            <div className={styles.meters}>
              {meters.map((m) => (
                <div key={m.id} className={styles.meter} data-meter={m.id}>
                  <ResourceBar layout="inline" label={m.label} value={m.value} />
                </div>
              ))}
            </div>
          )}
          {actionLabel != null && onAction != null && (
            <button type="button" className={styles.panelAction} onClick={onAction}>{actionLabel}</button>
          )}
        </>
      )}
    </GlassPanel>
  );
}

export function ActivityPanel({
  title = 'Поток активности',
  state = 'ready',
  data,
  series,
  label = 'Поток активности',
  emptyBody = 'Наблюдений активности пока нет.',
  actionLabel,
  onAction,
}: AliceHomeActivityPanelProps) {
  const seriesOk = (series ?? []).filter((s) => s.data.length >= 2);
  const single = data != null && data.length >= 2 ? [...data] : null;
  return (
    <GlassPanel className={styles.activityPanel} data-state={state} data-testid="activity-panel">
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
      </header>
      {state === 'loading' && <p className={styles.muted} role="status">Читаю наблюдения…</p>}
      {state === 'error' && (
        <>
          <p className={styles.muted} role="alert">Наблюдения недоступны.</p>
          {actionLabel != null && onAction != null && (
            <button type="button" className={styles.panelAction} onClick={onAction}>{actionLabel}</button>
          )}
        </>
      )}
      {(state === 'ready' || state === 'stale' || state === 'empty') && (
        seriesOk.length >= 2
          ? <ActivityRidges series={seriesOk} label={label} />
          : single != null
            ? <Sparkline data={single} width={312} height={64} area domain={[0, 100]} label={label} />
            : <p className={styles.muted}>{emptyBody}</p>
      )}
    </GlassPanel>
  );
}

function TimelineRow({ item }: { item: AliceHomeTimelineItem }) {
  return (
    <li className={styles.timelineRow}>
      <i className={styles.timelineDot} data-status={item.status ?? 'online'} aria-hidden="true" />
      <span className={styles.timelineTitle}>{item.title}</span>
      <time className={styles.timelineTime}>{item.timestamp}</time>
    </li>
  );
}

export function TodayTimeline({
  title = 'Сегодня',
  state = 'ready',
  items = [],
  emptyTitle = 'Событий пока нет',
  emptyBody = 'За сегодня прогонов и событий не зафиксировано.',
  onRefresh,
  actionLabel,
  onAction,
}: AliceHomeTodayTimelineProps) {
  return (
    <GlassPanel className={styles.todayPanel} data-state={state} data-testid="today-timeline">
      <header className={styles.panelHead}>
        <h2 className={styles.panelTitle}>{title}</h2>
        {onRefresh != null && (
          <button
            type="button"
            className={styles.panelIconButton}
            aria-label="Обновить события"
            title="Обновить"
            onClick={onRefresh}
          >
            <DotsGlyph />
          </button>
        )}
      </header>
      {state === 'loading' && <p className={styles.muted} role="status">Читаю события…</p>}
      {state === 'error' && (
        <>
          <p className={styles.muted} role="alert">События недоступны.</p>
          {actionLabel != null && onAction != null && (
            <button type="button" className={styles.panelAction} onClick={onAction}>{actionLabel}</button>
          )}
        </>
      )}
      {(state === 'ready' || state === 'stale' || state === 'empty') && (
        items.length > 0 ? (
          <ul className={styles.timeline}>
            {items.map((item) => <TimelineRow key={item.id} item={item} />)}
          </ul>
        ) : (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>{emptyTitle}</p>
            <p className={styles.muted}>{emptyBody}</p>
          </div>
        )
      )}
    </GlassPanel>
  );
}

/**
 * ALICE_HOME_01 template — pure view: DOM/CSS/SVG, no API/DB/router/Three.
 * AppShell owns topbar/sidebar/WindowFrame; this template renders only the
 * workspace + right rail regions. All data and callbacks arrive via props.
 */
export function AliceHomeTemplate({
  hero,
  capabilities = [],
  onCapabilitySelect,
  composer,
  systemStatus,
  activity,
  today,
  environmentImageSrc,
  environmentImageAlt = '',
  workspaceLabel = 'Рабочая область',
  railLabel = 'Статус и события',
  className,
}: AliceHomeTemplateProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} data-template="alice-home">
      <div className={styles.environment} aria-hidden="true">
        {environmentImageSrc != null && (
          <img className={styles.environmentImage} src={environmentImageSrc} alt={environmentImageAlt} draggable={false} />
        )}
        <span className={styles.environmentGrade} />
        <svg className={styles.ambient} viewBox="0 0 1200 900" preserveAspectRatio="none">
          <ellipse cx="1050" cy="140" rx="340" ry="120" />
          <ellipse cx="180" cy="780" rx="300" ry="100" />
          <path d="M60 460 Q 620 240 1180 420" />
        </svg>
      </div>
      <section className={styles.workspace} aria-label={workspaceLabel}>
        <AliceHero {...(hero ?? {})} />
        <CapabilityRail capabilities={capabilities} onSelect={onCapabilitySelect} />
        <CommandComposer
          agent={composer?.agent ?? '—'}
          mode={composer?.mode}
          modes={composer?.modes}
          onModeChange={composer?.onModeChange}
          value={composer?.value ?? ''}
          onValueChange={composer?.onValueChange ?? (() => undefined)}
          onSubmit={composer?.onSubmit ?? (() => undefined)}
          inputId={composer?.inputId}
          state={composer?.state ?? 'disabled'}
          voice={composer?.voice}
          attachment={composer?.attachment}
          tools={composer?.tools}
          toolsSummary={composer?.toolsSummary}
          submitLabel={composer?.submitLabel}
          placeholder={composer?.placeholder}
          error={composer?.error}
        />
      </section>
      <aside className={styles.rightRail} aria-label={railLabel}>
        <SystemStatusPanel {...(systemStatus ?? { state: 'empty' })} />
        <ActivityPanel {...(activity ?? { state: 'empty' })} />
        <TodayTimeline {...(today ?? { state: 'empty' })} />
      </aside>
    </div>
  );
}
