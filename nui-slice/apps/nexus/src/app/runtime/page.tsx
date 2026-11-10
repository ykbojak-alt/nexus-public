import { Suspense } from 'react';
import { RuntimeScreen } from '../../product/screens/runtime';

export default function Page() {
  return (
    <Suspense>
      <RuntimeScreen />
    </Suspense>
  );
}
