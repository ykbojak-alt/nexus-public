import styles from '../../../product/screens/alice-home-route-adapter.module.css';

export default function AliceRuntimeLoading() {
  return (
    <div className={styles.routeState} data-theme="alice" data-alice-route="runtime" role="status" aria-live="polite">
      <div className={styles.stateCard}>
        <span className={styles.stateMark} aria-hidden="true" />
        <h1>AGENT-A</h1>
        <p>Загружаю рабочую область…</p>
      </div>
    </div>
  );
}
