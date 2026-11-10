import { CoreViz, type CoreVizProps } from './core-frame';

export type CodexGeometryProps = Omit<CoreVizProps, 'kind' | 'title'> & { title?: string };

/** CODEX core — layer-reveal/orbit signature: stacked layers revealed over time. */
export function CodexGeometry({ title = 'Codex geometry', ...rest }: CodexGeometryProps) {
  return <CoreViz kind="codex" title={title} {...rest} />;
}
