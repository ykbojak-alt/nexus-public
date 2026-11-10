'use client';

import { NewfSystemPanel } from '../../product/screens/newf-system-panel';
import { withMagnetize } from '../../product/screens/newf-magnetize';

const MagnetizedSystem = withMagnetize('system', 'SYSTEM')(NewfSystemPanel);

export default function Page() {
  return <MagnetizedSystem />;
}
