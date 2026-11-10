'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Выбор ассистента выведен из потока: все старые ссылки ведут в runtime
 *  единственной ассистентки среды — AGENT-A */
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/runtime/alice');
  }, [router]);
  return null;
}
