import { SpatialViz, type SpatialVizProps } from './spatial-frame';

export type AgentConstellationProps = Omit<SpatialVizProps, 'kind' | 'title'> & { title?: string };

/** AgentConstellation — agents as a seeded star-field (spec §16). */
export function AgentConstellation({ title = 'Agent constellation', ...rest }: AgentConstellationProps) {
  return <SpatialViz kind="constellation" title={title} {...rest} />;
}
