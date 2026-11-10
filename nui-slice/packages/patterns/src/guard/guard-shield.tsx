import { CHART_CHROME, toneVar } from '@nexus/ui';
import { statusVar } from '../graphs/graph-frame';

/**
 * G.U.A.R.D. shield visual (runbook W4-06) — deterministic SVG twin of the
 * reference security-center composition: central shield + orbit ring with
 * satellite nodes (scanned domains / policies / network peers).
 *
 * Honest-state contract: 'unavailable'/'unknown' render the shield as an
 * outline with neutral tone and the status AS TEXT — never green, never a
 * fabricated "secure" or "0 threats". Satellite positions derive from
 * index, not wall-clock — the component is render-deterministic.
 */

export type GuardShieldState = 'secure' | 'watching' | 'scanning' | 'threat' | 'unavailable' | 'unknown';

export interface GuardShieldNode {
  id: string;
  label: string;
  /** Satellite kind — orbit lane semantics, e.g. 'domain' | 'policy' | 'peer'. */
  kind?: string;
}

export interface GuardShieldProps {
  state: GuardShieldState;
  nodes?: GuardShieldNode[];
  title?: string;
  /** Accessible state summary — required when state != 'unavailable'. */
  description?: string;
  width?: number;
  height?: number;
}

const STATE_TONE: Record<GuardShieldState, string> = {
  secure: statusVar('done'),
  watching: statusVar('active'),
  scanning: statusVar('pending'),
  threat: statusVar('failed'),
  unavailable: 'var(--nexus-chart-axis)',
  unknown: 'var(--nexus-chart-axis)',
};

const STATE_LABEL: Record<GuardShieldState, string> = {
  secure: 'secure',
  watching: 'watching',
  scanning: 'scanning',
  threat: 'threat detected',
  unavailable: 'unavailable — provider not connected',
  unknown: 'unknown',
};

export function GuardShield({
  state,
  nodes = [],
  title = 'G.U.A.R.D. security status',
  description,
  width = 240,
  height = 240,
}: GuardShieldProps) {
  const tone = STATE_TONE[state] ?? STATE_TONE.unknown;
  const label = STATE_LABEL[state] ?? STATE_LABEL.unknown;
  const cx = 100;
  const cy = 92;
  const orbitR = 72;
  const outline = state === 'unavailable' || state === 'unknown';

  return (
    <div data-guard-shield data-state={state} role="img" aria-label={`${title}: ${label}`} style={{ display: 'inline-block' }}>
      <svg viewBox="0 0 200 200" width={width} height={height} aria-hidden="true">
        {/* orbit ring — hairline when offline, full-stroke when live */}
        <circle
          cx={cx}
          cy={cy}
          r={orbitR}
          fill="none"
          stroke={outline ? CHART_CHROME.axis : tone}
          strokeWidth={outline ? 0.75 : 1.25}
          strokeDasharray={outline ? '3 4' : undefined}
          opacity={outline ? 0.5 : 0.8}
        />
        {/* satellite nodes — deterministic index positions on the orbit */}
        {nodes.map((n, i) => {
          const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2 - Math.PI / 2;
          const nx = cx + Math.cos(angle) * orbitR;
          const ny = cy + Math.sin(angle) * orbitR;
          return (
            <g key={n.id} data-node={n.id}>
              <circle cx={nx} cy={ny} r={4} fill={outline ? CHART_CHROME.axis : toneVar('primary')} />
              <text x={nx} y={ny - 8} textAnchor="middle" fontSize={7} fill={CHART_CHROME.label}>
                {n.label}
              </text>
            </g>
          );
        })}
        {/* shield glyph — outline-only when state is not authoritative */}
        <g transform={`translate(${cx - 26}, ${cy - 30})`}>
          <path
            d="M26 2 48 10v15c0 14-8.5 23.5-22 30C12.5 48.5 4 39 4 25V10L26 2Z"
            fill={outline ? 'none' : tone}
            fillOpacity={outline ? 0 : 0.18}
            stroke={tone}
            strokeWidth={1.5}
          />
          {outline ? (
            <path d="m18 22 5 5 12-13" fill="none" stroke={tone} strokeWidth={1.5} strokeDasharray="2 2" />
          ) : (
            <path d="m16 24 6 6 14-16" fill="none" stroke={tone} strokeWidth={2} />
          )}
        </g>
        {/* state as text — readable without color */}
        <text x={cx} y={188} textAnchor="middle" fontSize={9} fill={CHART_CHROME.label} data-state-text>
          {label}
        </text>
      </svg>
      {description ? <p style={{ margin: 0, fontSize: 12, color: CHART_CHROME.label, maxWidth: width, textAlign: 'center' }}>{description}</p> : null}
    </div>
  );
}
