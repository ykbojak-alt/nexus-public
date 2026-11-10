'use client';

import styles from '../../../product/screens/alice-home-route-adapter.module.css';

interface AliceRuntimeErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function AliceRuntimeError({ retry }: AliceRuntimeErrorProps) {
  return (
    <div className={styles.routeState} data-theme="alice" data-alice-route="runtime">
      <section className={styles.stateCard} aria-labelledby="alice-runtime-error-title">
        <h1 id="alice-runtime-error-title">AGENT-A временно недоступна</h1>
        <p role="alert">Не удалось отобразить рабочую область. Попробуйте загрузить её ещё раз.</p>
        <button className={styles.retryButton} type="button" onClick={retry}>
          Повторить загрузку
        </button>
      </section>
    </div>
  );
}
