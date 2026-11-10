import type { ReactNode } from 'react';
import styles from '../feedback.module.css';

export type NoticeTone = 'info' | 'success' | 'warning' | 'error';
const TONE_ROLE: Record<NoticeTone, 'status' | 'alert'> = {
  info: 'status', success: 'status', warning: 'alert', error: 'alert',
};

export function SystemNotice({className,  tone = 'info', title, children }: { className?: string; tone?: NoticeTone; title?: string; children?: ReactNode }) {
  return (
    <div className={[styles.notice, className].filter(Boolean).join(' ')} data-tone={tone} role={TONE_ROLE[tone]}>
      <div>
        {title != null && <div className={styles.noticeTitle}>{title}</div>}
        {children}
      </div>
    </div>
  );
}
