import Link from 'next/link';
import { PanelHeader } from '@nexus/ui';
import styles from '../../product/screens/screens.module.css';

/**
 * NEO2 P0: /tools index — не-404 список фирменных инструментов NEXUS
 * (пакеты из programs/manifest.ts с веб-панелями /tools/*).
 */
const TOOLS = [
  {
    href: '/tools/craft',
    title: 'NEXUS Craft',
    desc: 'Локальный craft-bridge: health, команды, pending/status, выполнение из allowlist, экспорт в workspace.',
  },
  {
    href: '/tools/office',
    title: 'NEXUS Office',
    desc: 'Оболочка документов, таблиц, слайдов и PDF без апстрима — офлайн, файл-доступ.',
  },
  {
    href: '/tools/tplayer',
    title: 'NEXUS TPLAYER',
    desc: 'Плеер с собственным P2P-движком: magnet/.torrent, файлы, http(s)-потоки, каталог Internet Archive.',
  },
  {
    href: '/tools/vloader',
    title: 'NEXUS VLOADER',
    desc: 'Загрузчик видео: самодостаточный пакет с движком, очередь задач, профили качества.',
  },
] as const;

export default function ToolsIndexPage() {
  return (
    <div className={styles.page} data-screen="tools" aria-labelledby="tools-title">
      <PanelHeader
        level="screen"
        divider={false}
        titleId="tools-title"
        title="Инструменты"
        subtitle="Фирменные инструменты NEXUS — локальные пакеты и веб-панели."
      />
      <ul className={styles.queueList}>
        {TOOLS.map((t) => (
          <li key={t.href} className={styles.queueItem}>
            <div className={styles.queueRow}>
              <span className={styles.queueNetwork}>{t.title}</span>
            </div>
            <p className={styles.queueText}>{t.desc}</p>
            <Link href={t.href} className={styles.linkBtn}>Открыть →</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
