'use client';

import { BootScreen } from '../product/screens/boot';
import { LiteShell } from '../product/lite/lite-shell';

const NUE_LITE = process.env.NEXT_PUBLIC_NUE_SURFACE === 'lite';

export default function Page() {
  return NUE_LITE ? <LiteShell /> : <BootScreen />;
}
