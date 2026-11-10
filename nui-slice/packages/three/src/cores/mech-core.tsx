import { CoreViz, type CoreVizProps } from './core-frame';

export type MechCoreProps = Omit<CoreVizProps, 'kind' | 'title'> & { title?: string };

/** MECH core — precise/linear signature: scan sweep over a regular ring. */
export function MechCore({ title = 'Mech core', ...rest }: MechCoreProps) {
  return <CoreViz kind="mech" title={title} {...rest} />;
}
