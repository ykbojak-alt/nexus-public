'use client';

import styles from '../../product/screens/alice-home-route-adapter.module.css';

interface HomeErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function HomeError({ retry }: HomeErrorProps) {
  return (
    <div className={styles.routeState} data-theme="alice" data-alice-route="home">
      <section className={styles.stateCard} aria-labelledby="alice-home-error-title">
        <h1 id="alice-home-error-title">AGENT-A временно недоступна</h1>
        <p role="alert">Не удалось отобразить рабочую область. Попробуйте загрузить её ещё раз.</p>
        <button className={styles.retryButton} type="button" onClick={retry}>
          Повторить загрузку
        </button>
      </section>
    </div>
  );
}
