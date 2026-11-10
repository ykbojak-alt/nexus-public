import { SpatialViz, type SpatialVizProps } from './spatial-frame';

export type KnowledgeOrbProps = Omit<SpatialVizProps, 'kind' | 'title'> & { title?: string };

/** KnowledgeOrb — knowledge nodes on tilted orbital rings. */
export function KnowledgeOrb({ title = 'Knowledge orb', ...rest }: KnowledgeOrbProps) {
  return <SpatialViz kind="orb" title={title} {...rest} />;
}
