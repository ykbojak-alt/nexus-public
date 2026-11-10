import { Suspense } from 'react';
import { NoirScreen } from '../../product/screens/noir';

export default function Page() {
  return (
    <Suspense>
      <NoirScreen />
    </Suspense>
  );
}
