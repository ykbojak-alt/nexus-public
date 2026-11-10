import { Suspense } from 'react';
import { RunScreen } from '../../product/screens/run';

export default function Page() {
  return (
    <Suspense>
      <RunScreen />
    </Suspense>
  );
}
