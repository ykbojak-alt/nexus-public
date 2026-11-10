import { SpatialViz, type SpatialVizProps } from './spatial-frame';

export type MemorySphereProps = Omit<SpatialVizProps, 'kind' | 'title'> & { title?: string };

/** MemorySphere — memory items as a dense uniform point field. */
export function MemorySphere({ title = 'Memory sphere', ...rest }: MemorySphereProps) {
  return <SpatialViz kind="sphere" title={title} {...rest} />;
}
