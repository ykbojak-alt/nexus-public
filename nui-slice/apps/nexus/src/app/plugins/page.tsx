import { Suspense } from 'react';
import { PluginsScreen } from '../../product/plugins/plugins-screen';

export default function Page() {
  return (
    <Suspense>
      <PluginsScreen />
    </Suspense>
  );
}
