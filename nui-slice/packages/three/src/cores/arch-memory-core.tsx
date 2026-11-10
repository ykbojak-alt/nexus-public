import { CoreViz, type CoreVizProps } from './core-frame';

export type ArchMemoryCoreProps = Omit<CoreVizProps, 'kind' | 'title'> & { title?: string };

/** ARCH core — depth/unfolding signature: nested shells opening over time. */
export function ArchMemoryCore({ title = 'Arch memory core', ...rest }: ArchMemoryCoreProps) {
  return <CoreViz kind="arch" title={title} {...rest} />;
}
