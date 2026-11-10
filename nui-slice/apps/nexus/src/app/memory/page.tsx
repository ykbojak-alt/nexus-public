import { Suspense } from 'react';
import { MemoryScreen } from '../../product/screens/memory';

export default function Page() {
  return (
    <Suspense>
      <MemoryScreen />
    </Suspense>
  );
}
