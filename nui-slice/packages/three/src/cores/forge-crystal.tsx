import { CoreViz, type CoreVizProps } from './core-frame';

export type ForgeCrystalProps = Omit<CoreVizProps, 'kind' | 'title'> & { title?: string };

/** FORGE core — build-up/convergence signature: facets spiraling inward. */
export function ForgeCrystal({ title = 'Forge crystal', ...rest }: ForgeCrystalProps) {
  return <CoreViz kind="forge" title={title} {...rest} />;
}
