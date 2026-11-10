import type { HTMLAttributes, ReactNode } from 'react';
import styles from './scenario-motion.module.css';
import type { CheckpointMotionState, ConfirmationMotionState } from './scenario-motion';

export interface ConfirmationMotionProps extends HTMLAttributes<HTMLDivElement> {
  state: ConfirmationMotionState;
  animated?: boolean;
  children: ReactNode;
}

/** Entry and resolution accents; the wrapped UI owns actions and real state. */
export function ConfirmationMotion({
  state,
  animated = true,
  className,
  children,
  ...rest
}: ConfirmationMotionProps) {
  return (
    <div
      className={[animated ? styles.confirmation : '', className].filter(Boolean).join(' ')}
      data-confirm-state={state}
      {...rest}
    >
      {children}
    </div>
  );
}

export interface DiffReviewMotionProps extends HTMLAttributes<HTMLDivElement> {
  animated?: boolean;
  children: ReactNode;
}

/** Animates the review surface and staggers up to five real changed-file rows. */
export function DiffReviewMotion({
  animated = true,
  className,
  children,
  ...rest
}: DiffReviewMotionProps) {
  return (
    <div className={[animated ? styles.diffReview : '', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </div>
  );
}

export interface CheckpointMotionProps extends HTMLAttributes<HTMLDivElement> {
  state: CheckpointMotionState;
  animated?: boolean;
  children: ReactNode;
}

/** Rewind progress/result accent; never starts a restore action itself. */
export function CheckpointMotion({
  state,
  animated = true,
  className,
  children,
  ...rest
}: CheckpointMotionProps) {
  return (
    <div
      className={[animated ? styles.checkpoint : '', className].filter(Boolean).join(' ')}
      data-checkpoint-state={state}
      {...rest}
    >
      {children}
    </div>
  );
}
