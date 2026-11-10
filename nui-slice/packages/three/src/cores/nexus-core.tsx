import { CoreViz, type CoreVizProps } from './core-frame';

export type NexusCoreProps = Omit<CoreVizProps, 'kind' | 'title'> & { title?: string };

/** NEXUS core — orbital signature: nested rings + counter-rotating orbiters. */
export function NexusCore({ title = 'Nexus core', ...rest }: NexusCoreProps) {
  return <CoreViz kind="nexus" title={title} {...rest} />;
}
