import { readFile } from 'node:fs/promises';
import { NEWF_DEFAULT_LAYOUT } from '../../product/screens/newf-default-layout';
import { NewfGate } from './gate';

/**
 * Инлайн-boot: до гидрации кладёт ?live=1&bridge=…&backend=…&shell=… в
 * window.__NEWF_QUERY__. Это резерв для static export (output:'export'), где
 * searchParams серверного компонента недоступен, а sync-read из location.search
 * в NewfGate срабатывает уже на клиенте (fix #372). Данные используются
 * только если клиентский sync-read почему-либо недоступен.
 */
function bootQueryScript(): string {
  return `window.__NEWF_QUERY__ = window.location.search || '';`;
}

/** Layout-источник (W100): по умолчанию — снапшот в нашем дереве
 *  (newf-default-layout.ts). Билд/рантайм НЕ трогают
 *  ~/.config/herdr-app — standalone NEWF не зависит от herdr-app.
 *  Переопределение на билде: NEWF_LAYOUT_PATH=<abs path к layout JSON>;
 *  output:'export' → чтение env/fs происходит во время `next build`. */
async function loadLayout(): Promise<string> {
  const custom = process.env.NEWF_LAYOUT_PATH;
  if (custom) {
    try {
      return await readFile(custom, 'utf-8');
    } catch {
      // fall through to bundled default
    }
  }
  return NEWF_DEFAULT_LAYOUT;
}

export default async function NewfPage() {
  const layoutJson = await loadLayout();
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: bootQueryScript() }} />
      <NewfGate layoutJson={layoutJson} />
    </>
  );
}
