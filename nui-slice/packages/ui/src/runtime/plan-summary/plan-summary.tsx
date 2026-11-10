import type { ReactNode } from 'react';
import { StatusBadge, type NexusStatus } from '../../feedback/status-badge/status-badge';
import type { PlanStepState } from '../types';
import styles from '../runtime.module.css';

export interface PlanStep {
  id: string;
  label: ReactNode;
  state?: PlanStepState;
  detail?: ReactNode;
}

const STEP_STATUS: Record<PlanStepState, NexusStatus> = {
  pending: 'waiting',
  running: 'executing',
  done: 'complete',
  blocked: 'warning',
  skipped: 'offline',
};

export interface PlanSummaryProps {
  className?: string;
  title?: ReactNode;
  /** Session goal — rendered verbatim. */
  goal?: ReactNode;
  steps?: PlanStep[];
}

/** Compact session plan: goal plus ordered steps with honest progress state.
 *  Rendered before/during execution so the user sees what will run — never a
 *  fabricated plan. */
export function PlanSummary({ className, title, goal, steps = [] }: PlanSummaryProps) {
  const done = steps.filter((s) => s.state === 'done').length;
  return (
    <div className={[styles.planSummary, className].filter(Boolean).join(' ')} data-testid="plan-summary">
      {title != null && <div className={styles.planTitle}>{title}</div>}
      {goal != null && <div className={styles.planGoal}>{goal}</div>}
      {steps.length > 0 && (
        <>
          <div className={styles.planProgress} aria-live="polite">
            {done} of {steps.length} steps done
          </div>
          <ol className={styles.planSteps}>
            {steps.map((step) => {
              const state = step.state ?? 'pending';
              return (
                <li key={step.id} className={styles.planStep} data-state={state}>
                  <span className={styles.planStepLabel}>{step.label}</span>
                  {step.detail != null && <span className={styles.planStepDetail}>{step.detail}</span>}
                  <StatusBadge status={STEP_STATUS[state]} label={state} />
                </li>
              );
            })}
          </ol>
        </>
      )}
    </div>
  );
}
