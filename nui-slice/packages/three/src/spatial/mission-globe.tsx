import { SpatialViz, type SpatialVizProps } from './spatial-frame';

export type MissionGlobeProps = Omit<SpatialVizProps, 'kind' | 'title'> & { title?: string };

/** MissionGlobe — mission nodes at deterministic lat/long on a sphere. */
export function MissionGlobe({ title = 'Mission globe', ...rest }: MissionGlobeProps) {
  return <SpatialViz kind="globe" title={title} {...rest} />;
}
