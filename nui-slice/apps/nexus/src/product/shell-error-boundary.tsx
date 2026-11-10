'use client';

import { Component, type ReactNode } from 'react';
import { formatErrorJournal, recordErrorJournalEntry } from './error-journal';
import styles from './shell-error-boundary.module.css';

interface Props {
  children: ReactNode;
}

interface State {
  message: string | null;
}

// Граница падения экрана — аналог того, как dsh-основное окно переживает падение
// renderer-процесса: хром оболочки (рейл, бары, док) смонтирован выше границы
// и остаётся живым; падает только содержимое экрана. Падение пишется в
// error-journal — аналог crash-журнала с перезапуском.
export class ShellErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    recordErrorJournalEntry(
      'boundary',
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      (error instanceof Error ? error.stack : undefined) ?? info.componentStack ?? undefined,
    );
  }

  private reload = () => window.location.reload();

  private copyDiagnostics = () => {
    const text = formatErrorJournal();
    void navigator.clipboard?.writeText(text).catch(() => {
      const area = document.createElement('textarea');
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand('copy');
      area.remove();
    });
  };

  render(): ReactNode {
    if (this.state.message == null) return this.props.children;
    return (
      <div className={styles.crashCard} role="alert">
        <h2>Экран упал</h2>
        <p className={styles.crashMessage}>{this.state.message}</p>
        <div className={styles.crashActions}>
          <button type="button" onClick={this.reload}>Перезагрузить</button>
          <button type="button" onClick={this.copyDiagnostics}>Скопировать диагностику</button>
        </div>
      </div>
    );
  }
}
