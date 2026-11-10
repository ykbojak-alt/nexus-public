import { useId, type ReactNode } from 'react';
import { Button } from '../actions/button/button';
import styles from './agent-chat.module.css';

/** Режим композитора — три канона Copilot (agent/ask/plan). Режим влияет на
 *  профиль прогона: agent — с инструментами, ask — вопрос, plan — план.
 *  Значение хранит вызывающий; компонент только отражает его. */
export type AgentComposerMode = 'agent' | 'ask' | 'plan';

export const AGENT_COMPOSER_MODES: Record<AgentComposerMode, string> = {
  agent: 'АГЕНТ',
  ask: 'СПРОСИТЬ',
  plan: 'ПЛАН',
};

export interface AgentComposerModel {
  value: string;
  label: string;
}

export interface AgentComposerProps {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  inputLabel: string;
  mode: AgentComposerMode;
  onModeChange: (mode: AgentComposerMode) => void;
  /** Доступные модели из профиля/адаптера. undefined — пикера нет;
   *  пустой массив — честный «Модель: нет данных». */
  models?: AgentComposerModel[];
  model?: string;
  onModelChange?: (value: string) => void;
  /** Слот вложений/упоминаний — вызывающий рендерит AttachmentList и пр. */
  attachments?: ReactNode;
  placeholder?: string;
  submitLabel?: string;
  pending?: boolean;
  disabled?: boolean;
}

/** Композитор чата агента: ввод + строка режима (agent|ask|plan) и выбор
 *  модели. Клавиатура: Enter — отправка, режимы — radiogroup (стрелки по
 *  нативной схеме через Tab/Space на кнопках). */
export function AgentComposer({
  className, value, onChange, onSubmit, inputLabel,
  mode, onModeChange, models, model, onModelChange,
  attachments, placeholder, submitLabel = 'Отправить',
  pending = false, disabled = false,
}: AgentComposerProps) {
  const groupId = useId();
  const canSubmit = !pending && !disabled && value.trim().length > 0;
  const modes = Object.keys(AGENT_COMPOSER_MODES) as AgentComposerMode[];
  return (
    <div className={[styles.composerWrap, className].filter(Boolean).join(' ')} data-testid="agent-composer">
      {attachments != null && attachments}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey && canSubmit) { e.preventDefault(); onSubmit(); }
        }}
        placeholder={placeholder}
        aria-label={inputLabel}
        disabled={disabled}
        rows={3}
        style={{
          resize: 'vertical', width: '100%', border: 0, background: 'transparent',
          color: 'inherit', font: 'inherit', outline: 'none',
        }}
      />
      <div className={styles.modeRow}>
        <div className={styles.modeGroup} role="radiogroup" aria-label="Режим агента" aria-labelledby={`${groupId}-mode`}>
          <span id={`${groupId}-mode`} hidden>Режим агента</span>
          {modes.map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              tabIndex={mode === m ? 0 : -1}
              className={styles.modeBtn}
              onClick={() => onModeChange(m)}
              disabled={disabled}
              data-mode={m}
            >
              {AGENT_COMPOSER_MODES[m]}
            </button>
          ))}
        </div>
        {models == null ? null : models.length === 0 ? (
          <span className={styles.modelNone}>Модель: нет данных</span>
        ) : (
          <select
            className={styles.modelSelect}
            aria-label="Модель"
            value={model}
            onChange={(e) => onModelChange?.(e.target.value)}
            disabled={disabled}
            data-testid="agent-composer-model"
          >
            {models.map((mo) => <option key={mo.value} value={mo.value}>{mo.label}</option>)}
          </select>
        )}
        <Button variant="primary" size="sm" onClick={onSubmit} loading={pending} disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
