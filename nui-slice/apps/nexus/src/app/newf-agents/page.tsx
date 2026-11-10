'use client';

import { NewfAgentsPanel } from '../../product/screens/newf-agents-panel';
import { withMagnetize } from '../../product/screens/newf-magnetize';
import { StatusBar } from '../../product/screens/newf-status-bar';
import { createCoreBridge } from '../../product/screens/newf-live';
import { useMemo } from 'react';

const MagnetizedAgents = withMagnetize('agents', 'SPACES & AGENTS')(NewfAgentsPanel);

/** Isolated live demo for the NEWF Spaces & Agents sidebar. */
export default function NewfAgentsPage() {
  const bridge = useMemo(() => createCoreBridge(), []);
  return (
    <>
      <MagnetizedAgents bridge={bridge} />
      <StatusBar bridge={bridge} />
    </>
  );
}
