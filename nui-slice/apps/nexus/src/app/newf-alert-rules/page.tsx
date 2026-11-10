'use client';

import { AlertRulesPanel } from '../../product/screens/newf-alert-rules-panel';
import { createCoreBridge } from '../../product/screens/newf-live';
import { withMagnetize } from '../../product/screens/newf-magnetize';

const MagnetizedAlertRules = withMagnetize('alert-rules', 'ALERT RULES')(AlertRulesPanel);

/** Isolated live demo for the NEWF Alert-rules panel (W37). */
export default function NewfAlertRulesPage() {
  return <MagnetizedAlertRules bridge={createCoreBridge()} />;
}
