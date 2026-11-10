import { CHART_CHROME } from '@nexus/ui';
import { capMarkerText, type CappedGraph } from './caps';

/**
 * Honest truncation badge for the SVG canvas (W4-07): when caps hide
 * nodes/edges the canvas says so in text — color is never the carrier.
 * Positioned top-right inside the viewBox so it stays with the drawing.
 */
export function CapMarker({ hidden, width }: { hidden: CappedGraph['hidden']; width: number }) {
  const text = capMarkerText(hidden);
  if (text == null) return null;
  return (
    <text
      data-truncated
      x={width - 8}
      y={16}
      textAnchor="end"
      fontSize={11}
      fill={CHART_CHROME.label}
    >
      {text}
    </text>
  );
}
