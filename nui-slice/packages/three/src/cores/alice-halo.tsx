import { CoreViz, type CoreVizProps } from './core-frame';

export type AliceHaloProps = Omit<CoreVizProps, 'kind' | 'title'> & { title?: string };

/** ALICE core — breathing/radial signature: halo ring + radial spokes. */
export function AliceHalo({ title = 'Alice halo', ...rest }: AliceHaloProps) {
  return <CoreViz kind="alice" title={title} {...rest} />;
}
