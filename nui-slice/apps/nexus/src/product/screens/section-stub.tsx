'use client';

import { GlassPanel, PanelHeader } from '@nexus/ui';
import styles from './screens.module.css';

/** Honest placeholder for sections scheduled after the alpha slice. */
export function SectionStub({ name }: { name: string }) {
  return (
    <div className={styles.page} data-screen="section-stub" aria-labelledby="section-stub-title">
      <PanelHeader level="screen" divider={false} titleId="section-stub-title" title={name} />
      <GlassPanel className={styles.panel} data-state="empty">
        <p className={styles.emptyHint}>
          Раздел в работе — экран и состояния описаны в docs/product/page-maps.md,
          сценарии — в docs/product/screen-scenarios.md.
        </p>
      </GlassPanel>
    </div>
  );
}
