import { Button } from '../../actions/button/button';
import styles from '../runtime.module.css';

export interface ComposerProps {
  className?: string;
  value: string;
  onChange: (value: string) => void;
  /** Fires on Enter or the submit button — caller performs the write.
   *  The component never sends on its own and blocks submit while pending
   *  or on empty input. */
  onSubmit: () => void;
  /** Accessible label for the text input (no visible label by design). */
  inputLabel: string;
  placeholder?: string;
  submitLabel?: string;
  /** True while the caller's write is in flight — blocks double submit. */
  pending?: boolean;
  disabled?: boolean;
}

/** Message/comment composer — the only write surface for provider chat.
 *  A submit here is always an explicit user action; agent writes stay
 *  outside this component by contract. */
export function Composer({
  className, value, onChange, onSubmit, inputLabel,
  placeholder, submitLabel = 'Отправить', pending = false, disabled = false,
}: ComposerProps) {
  const canSubmit = !pending && !disabled && value.trim().length > 0;
  return (
    <div className={[styles.composer, className].filter(Boolean).join(' ')} data-testid="composer">
      <input
        className={styles.composerInput}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) { e.preventDefault(); onSubmit(); } }}
        placeholder={placeholder}
        aria-label={inputLabel}
        disabled={disabled}
      />
      <Button variant="primary" size="sm" onClick={onSubmit} loading={pending} disabled={!canSubmit}>
        {submitLabel}
      </Button>
    </div>
  );
}
