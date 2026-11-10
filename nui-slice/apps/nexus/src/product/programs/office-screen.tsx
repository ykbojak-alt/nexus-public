import Link from 'next/link';
import { GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import styles from './vloader.module.css';

export function OfficeScreen() {
  return (
    <main className={styles.page} data-screen="office" aria-labelledby="office-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="office-title"
        title="NEXUS Office"
        subtitle="ElixirOffice — локальная сборка офисного пакета в NEXUS"
        actions={<StatusBadge status="info" label="локальная интеграция" />}
      />

      <div className={styles.grid}>
        <GlassPanel className={styles.panel}>
          <p className={styles.kicker}>Честная интеграция без скрытых API</p>
          <h2 className={styles.heading}>ElixirOffice — собранный из исходников</h2>
          <p className={styles.body}>
            NEXUS Office — это установленная сборка ElixirOffice (Electron), собранная из
            исходного кода. NEXUS отображает её как программу каталога и даёт точки входа;
            сам офисный пакет работает отдельным окном и не проксируется через сервер NEXUS.
          </p>

          <div className={styles.steps} aria-label="Запуск ElixirOffice">
            <div className={styles.step}>
              <span className={styles.stepLabel}>1 — Установлено локально</span>
              <pre><code>D:\ElixirOffice\ElixirOffice.exe</code></pre>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>2 — Запуск из PowerShell</span>
              <pre><code>Start-Process 'D:\ElixirOffice\ElixirOffice.exe'</code></pre>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>3 — Или из меню «Пуск»</span>
              <pre><code>ElixirOffice</code></pre>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className={styles.panel}>
          <p className={styles.kicker}>Что нужно знать</p>
          <ul className={styles.facts}>
            <li>Сборка — desktop Electron-приложение из исходного кода ElixirOffice.</li>
            <li>Документы и словари лежат в <code>D:\ElixirOffice\resources\</code>.</li>
            <li>NEXUS не запускает процесс из браузера и не проксирует документы.</li>
            <li>Деинсталляция — <code>Uninstall ElixirOffice.exe</code> в каталоге установки.</li>
          </ul>
          <div className={styles.links}>
            <Link href="/programs">Назад к «Программам»</Link>
          </div>
        </GlassPanel>
      </div>
    </main>
  );
}
