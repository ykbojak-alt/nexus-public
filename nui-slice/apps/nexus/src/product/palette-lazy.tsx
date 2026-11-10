'use client';

// wave-XIII W4 perf: точечная граница для next/dynamic — namespace-импорт
// бандла @nexus/ui снимает tree-shaking и раздувает общий чанк на ~60 КБ.
import { CommandPalette } from '@nexus/ui';

export default CommandPalette;
