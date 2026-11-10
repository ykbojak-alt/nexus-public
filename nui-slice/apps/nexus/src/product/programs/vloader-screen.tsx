import Link from 'next/link';
import { GlassPanel, PanelHeader, StatusBadge } from '@nexus/ui';
import styles from './vloader.module.css';

export function VLoaderScreen() {
  return (
    <main className={styles.page} data-screen="vloader" aria-labelledby="vloader-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="vloader-title"
        title="NEXUS VLOADER"
        subtitle="CLI-компаньон NEXUS для локального архивирования видео"
        actions={<StatusBadge status="info" label="ТРЕБУЕТ НАСТРОЙКИ" />}
      />

      <div className={styles.grid}>
        <GlassPanel className={styles.panel}>
          <p className={styles.kicker}>Локальный инструмент · открытый исходный код</p>
          <h2 className={styles.heading}>Видео — в вашем терминале</h2>
          <p className={styles.body}>
            NEXUS VLoader — интеграция открытого CLI Yoinks (Node.js-обёртка над yt-dlp,
            MIT). NEXUS добавляет её в каталог программ и документирует запуск; сам
            инструмент не встроен в браузерный UI и не передаёт URL или видео через
            сервер NEXUS.
          </p>

          <div className={styles.steps} aria-label="Установка и запуск">
            <div className={styles.step}>
              <span className={styles.stepLabel}>1 · Установить</span>
              <pre><code>npm install --global yoinks</code></pre>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>2 · Запустить</span>
              <pre><code>yoinks</code></pre>
            </div>
            <div className={styles.step}>
              <span className={styles.stepLabel}>Или открыть сразу с URL</span>
              <pre><code>yoinks &lt;url&gt;</code></pre>
            </div>
          </div>
        </GlassPanel>

        <GlassPanel className={styles.panel}>
          <p className={styles.kicker}>Что нужно знать</p>
          <ul className={styles.facts}>
            <li>Требуется Node.js 18 или новее.</li>
            <li>Yoinks использует yt-dlp; ffmpeg нужен для объединения потоков и MP3.</li>
            <li>При первом запуске Yoinks может скачать yt-dlp в пользовательский каталог.</li>
            <li>Поддержка сайтов и доступность видео зависят от самого yt-dlp и платформ.</li>
          </ul>
          <div className={styles.links}>
            <a href="https://github.com/pablostanley/yoinks" target="_blank" rel="noopener noreferrer">
              Репозиторий GitHub · MIT
            </a>
            <Link href="/programs">Назад в «Программы»</Link>
          </div>
        </GlassPanel>
      </div>

      <aside className={styles.notice} aria-label="Правила использования">
        <strong>Используйте только разрешённый контент.</strong>
        <span>
          Перед загрузкой проверьте права на материал и условия платформы. Интеграция NEXUS
          не обходит DRM, авторизацию или ограничения доступа.
        </span>
      </aside>
    </main>
  );
}
