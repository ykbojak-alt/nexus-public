'use client';

import { useEffect, useRef } from 'react';
import type { AliceHomeCoreState } from './types';

/** Palette resolved from the semantic core state — the sphere tells status
 *  by colour before any text is read. The resting palette follows the
 *  reference: pale glass body, white-gold nucleus with a horizontal flare,
 *  gold + cyan orbits with one glowing satellite per active process. */
interface CorePalette {
  ring: [number, number, number];      // wireframe + orbit hoops
  core: [number, number, number];      // nucleus body
  glow: [number, number, number];      // nucleus halo (counter-light)
  alpha: number;                       // global opacity (offline dims)
  spinMul: number;                     // state speed multiplier
  breathHz: number;                    // nucleus pulse rate
}

const GOLD: [number, number, number] = [232, 200, 138];   // --nexus-accent-primary на сцене
const CREAM: [number, number, number] = [255, 240, 208];
const WHITE: [number, number, number] = [255, 252, 244];
const TEAL: [number, number, number] = [92, 226, 238];
const AMBER: [number, number, number] = [245, 166, 59];
const CORAL: [number, number, number] = [249, 127, 102];

function paletteFor(state: AliceHomeCoreState): CorePalette {
  switch (state) {
    case 'healthy':
      return { ring: GOLD, core: CREAM, glow: TEAL, alpha: 1, spinMul: 1, breathHz: 0.14 };
    case 'thinking':
    case 'syncing':
      return { ring: GOLD, core: TEAL, glow: TEAL, alpha: 1, spinMul: 1.9, breathHz: 0.34 };
    case 'attention':
      return { ring: AMBER, core: CREAM, glow: AMBER, alpha: 1, spinMul: 1.15, breathHz: 0.22 };
    case 'degraded':
      return { ring: AMBER, core: CORAL, glow: AMBER, alpha: 0.96, spinMul: 0.85, breathHz: 0.3 };
    case 'critical':
      return { ring: CORAL, core: [255, 96, 70], glow: CORAL, alpha: 1, spinMul: 2.4, breathHz: 0.55 };
    case 'offline':
      return { ring: [140, 146, 152], core: [170, 174, 178], glow: [140, 146, 152], alpha: 0.5, spinMul: 0.12, breathHz: 0.06 };
  }
}

const rgba = (c: [number, number, number], a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

interface Vec3 { x: number; y: number; z: number }

/** An orbit fixed in the sphere's own frame: a circle in the XZ plane tilted
 *  about X, then about Z. Because the tilt happens before the camera
 *  transform, the orbits travel with the model when the user drags. */
interface Hoop {
  r: number;
  cosX: number; sinX: number;
  cosZ: number; sinZ: number;
  phase: number;
  /** Per-orbit angular velocity factor — satellites must not march in lockstep. */
  rate: number;
  gold: boolean;
}

function makeHoop(r: number, tiltX: number, tiltZ: number, phase: number, rate: number, gold: boolean): Hoop {
  return { r, cosX: Math.cos(tiltX), sinX: Math.sin(tiltX), cosZ: Math.cos(tiltZ), sinZ: Math.sin(tiltZ), phase, rate, gold };
}

function hoopPoint(h: Hoop, a: number): Vec3 {
  const x = Math.cos(a) * h.r;
  const z0 = Math.sin(a) * h.r;
  const y1 = -h.sinX * z0;
  const z1 = h.cosX * z0;
  return { x: h.cosZ * x - h.sinZ * y1, y: h.sinZ * x + h.cosZ * y1, z: z1 };
}

/** The orbital rig: seven attitudes, gold/cyan alternating — the reference
 *  reads as «множество орбит», and satellites wrap onto these orbits. */
const ORBITS: Hoop[] = [
  makeHoop(1.42, -0.34, 0.12, 0.0, 1.0, true),
  makeHoop(1.26, 0.92, -0.3, 2.1, 1.22, false),
  makeHoop(1.56, 0.16, 1.22, 1.1, 0.84, true),
  makeHoop(1.18, -1.12, 0.58, 3.4, 1.4, false),
  makeHoop(1.64, 0.6, -1.02, 4.6, 0.72, true),
  makeHoop(1.34, 1.36, 0.26, 5.6, 1.1, false),
  makeHoop(1.5, -0.72, -0.82, 0.8, 0.94, true),
];

/** Hard ceiling on drawn satellites — past this the count stops being
 *  visually honest at 196 px. Real host process counts stay far below it. */
const MAX_SATELLITES = 14;

/** One glowing satellite per active process. null/NaN → none drawn, so no
 *  process count is implied; 0 → none, matching «активных процессов нет». */
function satellitesShown(processes: number | null | undefined): number {
  if (processes == null || !Number.isFinite(processes)) return 0;
  return Math.min(Math.max(Math.round(processes), 0), MAX_SATELLITES);
}

/** Deterministic sparkle field (mulberry32 seed): points in a shell around
 *  the volume that twinkle — the reference's dust. Composition only, no data. */
const SPARKS = (() => {
  let s = 0x9e3779b9;
  const rnd = () => {
    s = Math.imul(s ^ (s >>> 15), s | 1) ^ s;
    s ^= s + Math.imul(s ^ (s >>> 7), s | 61);
    return ((s ^ (s >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 22 }, () => {
    const th = rnd() * Math.PI * 2;
    const phi = (rnd() - 0.5) * Math.PI * 0.9;
    const r = 1.15 + rnd() * 0.75;
    return {
      p: { x: Math.cos(phi) * Math.cos(th) * r, y: Math.sin(phi) * r * 0.8, z: Math.cos(phi) * Math.sin(th) * r } as Vec3,
      hz: 0.4 + rnd() * 1.4,
      ph: rnd() * Math.PI * 2,
      gold: rnd() > 0.45,
    };
  });
})();

interface CoreSphereProps {
  state: AliceHomeCoreState;
  /** Real host load 0..1 (CPU share). Drives spin speed and wireframe
   *  brightness — the sphere is telemetry, not decoration. */
  load?: number | null;
  /** Second channel (RAM share 0..1) — scales the nucleus halo. */
  loadB?: number | null;
  /** Active processes on the PCA: one orbiting satellite each. null means
   *  the host has not answered — no satellites, no implied count. */
  processes?: number | null;
  /** Logical box size in px. */
  size?: number;
}

/**
 * Volumetric runtime core — a glowing armillary orb on a 2D canvas
 * (orthographic projection, back-face occlusion, breathing nucleus, one
 * satellite sphere per active process with a fading light trail).
 *
 * Telemetry binding: `load` steers angular velocity and front-segment alpha;
 * `processes` steers the satellite count 1:1; `state` steers palette and pulse.
 *
 * Manipulation: pointer drag orbits the camera (yaw + clamped pitch) with
 * inertia that decays back into the telemetry spin; arrows rotate it the same
 * way from the keyboard. Under `prefers-reduced-motion` nothing moves on its
 * own, but a drag still tracks the pointer.
 */
export function CoreSphere({ state, load = null, loadB = null, processes = null, size = 196 }: CoreSphereProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // Latest values via ref so the rAF loop is never restarted per prop tick.
  const live = useRef({ state, load, loadB, processes });
  live.current = { state, load, loadB, processes };

  useEffect(() => {
    const canvas = ref.current;
    if (canvas == null) return;
    const ctx = canvas.getContext('2d');
    if (ctx == null) return;

    let dirty = true;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const fit = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(size * dpr));
      canvas.height = Math.max(1, Math.round(size * dpr));
      dirty = true;
    };
    fit();
    window.addEventListener('resize', fit);

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // --- static geometry (unit sphere) --------------------------------------
    const LAT = 6, LON = 10, STEPS = 56;
    const lats: Vec3[][] = [];
    for (let i = 1; i <= LAT; i += 1) {
      const phi = -Math.PI / 2 + (i * Math.PI) / (LAT + 1);
      const ring: Vec3[] = [];
      for (let s = 0; s <= STEPS; s += 1) {
        const th = (s / STEPS) * Math.PI * 2;
        ring.push({
          x: Math.cos(phi) * Math.cos(th),
          y: Math.sin(phi),
          z: Math.cos(phi) * Math.sin(th),
        });
      }
      lats.push(ring);
    }
    const lons: Vec3[][] = [];
    for (let i = 0; i < LON; i += 1) {
      const th = (i * Math.PI * 2) / LON;
      const ring: Vec3[] = [];
      for (let s = 0; s <= STEPS; s += 1) {
        const phi = -Math.PI / 2 + (s / STEPS) * Math.PI;
        ring.push({
          x: Math.cos(phi) * Math.cos(th),
          y: Math.sin(phi),
          z: Math.cos(phi) * Math.sin(th),
        });
      }
      lons.push(ring);
    }

    // Satellite fades so spheres appear/disappear smoothly with telemetry.
    const satFade = new Array<number>(MAX_SATELLITES).fill(0);

    // --- camera / manipulation ----------------------------------------------
    const PITCH_LIMIT = 1.15;
    let yaw = 0.9;
    let pitch = 0.42;           // the sphere axis lean — gives the volume its pose
    let velYaw = 0;             // rad/s, inertia after a release
    let velPitch = 0;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let smoothLoad = 0;
    let smoothLoadB = 0;
    let prev = performance.now();

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velYaw = 0;
      velPitch = 0;
      canvas.setPointerCapture(e.pointerId);
      canvas.dataset.dragging = 'true';
      dirty = true;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw += dx * 0.008;
      pitch = Math.min(Math.max(pitch + dy * 0.006, -PITCH_LIMIT), PITCH_LIMIT);
      // Keep the release velocity from the last few px so a flick coasts.
      velYaw = dx * 0.5;
      velPitch = dy * 0.38;
      dirty = true;
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging) return;
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      delete canvas.dataset.dragging;
    };
    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 0.42 : 0.16;
      const k = e.key;
      if (k === 'ArrowLeft') yaw -= step;
      else if (k === 'ArrowRight') yaw += step;
      else if (k === 'ArrowUp') pitch = Math.max(pitch - step * 0.7, -PITCH_LIMIT);
      else if (k === 'ArrowDown') pitch = Math.min(pitch + step * 0.7, PITCH_LIMIT);
      else return;
      e.preventDefault();
      dirty = true;
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    canvas.addEventListener('keydown', onKeyDown);

    const draw = (now: number) => {
      const dt = Math.min((now - prev) / 1000, 0.1);
      prev = now;
      const t = now / 1000;
      const { state: st, load: ld, loadB: ldb, processes: pr } = live.current;
      const P = paletteFor(st);

      const target = ld == null ? 0 : Math.min(Math.max(ld, 0), 1);
      const targetB = ldb == null ? 0 : Math.min(Math.max(ldb, 0), 1);
      const loadDelta = Math.abs(target - smoothLoad) + Math.abs(targetB - smoothLoadB);
      smoothLoad += (target - smoothLoad) * Math.min(dt * 2.4, 1);
      smoothLoadB += (targetB - smoothLoadB) * Math.min(dt * 2.4, 1);

      // One satellite per active process, fading in/out with telemetry.
      const satCount = satellitesShown(pr);
      for (let i = 0; i < satFade.length; i += 1) {
        const goal = i < satCount ? 1 : 0;
        const d = goal - satFade[i];
        if (Math.abs(d) > 0.004) {
          satFade[i] += d * Math.min(dt * 3.2, 1);
          dirty = true;
        } else if (satFade[i] !== goal) {
          satFade[i] = goal;
          dirty = true;
        }
      }

      if (!dragging) {
        yaw += velYaw * dt;
        pitch = Math.min(Math.max(pitch + velPitch * dt, -PITCH_LIMIT), PITCH_LIMIT);
        const decay = Math.exp(-dt * 2.6);
        velYaw *= decay;
        velPitch *= decay;
        if (Math.abs(velYaw) < 0.02) velYaw = 0;
        if (Math.abs(velPitch) < 0.02) velPitch = 0;
        // The telemetry spin only takes over once the flick has died down,
        // so a hand-placed view does not drift away mid-reading.
        if (velYaw === 0 && !reduce) yaw += dt * (0.22 + smoothLoad * 0.85) * P.spinMul;
      }
      if (loadDelta > 0.002) dirty = true;

      if (!dirty) return;
      dirty = false;

      const w = canvas.width;
      const c = w / 2;
      const R = w * 0.335;
      ctx.clearRect(0, 0, w, w);

      const breath = reduce ? 1 : 1 + Math.sin(t * Math.PI * 2 * P.breathHz) * (0.05 + smoothLoad * 0.07);
      const flick = !reduce && st === 'critical' ? (Math.sin(t * 31) * Math.sin(t * 17.3) > 0.72 ? 0.72 : 1) : 1;

      const cosY = Math.cos(yaw), sinY = Math.sin(yaw);
      const cosP = Math.cos(pitch), sinP = Math.sin(pitch);
      const project = (p: Vec3) => {
        // yaw about Y, then pitch about X — the camera, not the model
        const x1 = p.x * cosY + p.z * sinY;
        const z1 = -p.x * sinY + p.z * cosY;
        const y2 = p.y * cosP - z1 * sinP;
        const z2 = p.y * sinP + z1 * cosP;
        return { sx: c + x1 * R, sy: c - y2 * R, z: z2 };
      };

      // halo — radius breathes with the RAM channel
      const haloR = R * (1.5 + smoothLoadB * 0.28) * breath;
      const halo = ctx.createRadialGradient(c, c, R * 0.4, c, c, haloR);
      halo.addColorStop(0, rgba(P.glow, 0.14 * P.alpha * flick));
      halo.addColorStop(0.55, rgba(P.ring, 0.05 * P.alpha * flick));
      halo.addColorStop(1, rgba(P.glow, 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, w);

      const strokePath = (
        ring: Vec3[],
        alphaBack: number,
        alphaFront: number,
      ) => {
        // Split at z=0: back half drawn dim → real occlusion by the volume.
        for (const front of [false, true]) {
          ctx.beginPath();
          let pen = false;
          for (let s = 0; s < ring.length; s += 1) {
            const q = project(ring[s]);
            const on = front ? q.z >= -0.02 : q.z < 0.02;
            if (on) {
              if (pen) ctx.lineTo(q.sx, q.sy);
              else ctx.moveTo(q.sx, q.sy);
              pen = true;
            } else if (pen) {
              ctx.lineTo(q.sx, q.sy);
              pen = false;
            }
          }
          ctx.strokeStyle = rgba(P.ring, (front ? alphaFront : alphaBack) * P.alpha);
          ctx.lineWidth = Math.max(1, w * 0.0035);
          ctx.stroke();
        }
      };

      // pale glass body — light blue-white like the reference, not dark
      const body = ctx.createRadialGradient(
        c - R * 0.36, c - R * 0.42, R * 0.06,
        c, c, R,
      );
      body.addColorStop(0, `rgba(226,242,255,${0.32 * P.alpha})`);
      body.addColorStop(0.45, `rgba(130,178,214,${0.18 * P.alpha})`);
      body.addColorStop(0.82, `rgba(70,110,150,${0.24 * P.alpha})`);
      body.addColorStop(1, rgba(P.ring, 0.26 * P.alpha));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fill();

      // cool under-glow — the cyan bounce light in the reference's lower limb
      const under = ctx.createRadialGradient(c + R * 0.18, c + R * 0.62, 0, c + R * 0.18, c + R * 0.62, R * 0.75);
      under.addColorStop(0, rgba(P.glow, 0.24 * P.alpha));
      under.addColorStop(1, rgba(P.glow, 0));
      ctx.fillStyle = under;
      ctx.beginPath();
      ctx.arc(c, c, R, 0, Math.PI * 2);
      ctx.fill();

      const wireBoost = 0.26 + smoothLoad * 0.2;
      for (const ring of lats) strokePath(ring, 0.1, wireBoost);
      for (const ring of lons) strokePath(ring, 0.09, wireBoost * 0.85);

      // rim — the glass edge reads as a full circle, bright top-left,
      // cool and faint bottom-right (counter-light side)
      ctx.beginPath();
      ctx.arc(c, c, R * 0.995, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(P.ring, 0.3 * P.alpha);
      ctx.lineWidth = Math.max(1, w * 0.004);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, R, Math.PI * 1.12, Math.PI * 1.62);
      ctx.strokeStyle = rgba(P.ring, 0.6 * P.alpha);
      ctx.lineWidth = Math.max(1, w * 0.006);
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(c, c, R * 0.99, Math.PI * 0.15, Math.PI * 0.6);
      ctx.strokeStyle = rgba(P.glow, 0.34 * P.alpha);
      ctx.lineWidth = Math.max(1, w * 0.004);
      ctx.lineCap = 'round';
      ctx.stroke();
      const spec = ctx.createRadialGradient(c - R * 0.4, c - R * 0.44, 0, c - R * 0.4, c - R * 0.44, R * 0.3);
      spec.addColorStop(0, `rgba(255,255,255,${0.22 * P.alpha})`);
      spec.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = spec;
      ctx.beginPath();
      ctx.ellipse(c - R * 0.4, c - R * 0.44, R * 0.34, R * 0.18, -0.5, 0, Math.PI * 2);
      ctx.fill();

      // nucleus — white-hot core with a wide bloom and a horizontal flare
      const nr = R * 0.3 * breath;
      const nuc = ctx.createRadialGradient(c, c, 0, c, c, nr * 2.4);
      nuc.addColorStop(0, rgba(WHITE, 0.98 * P.alpha * flick));
      nuc.addColorStop(0.22, rgba(P.core, 0.75 * P.alpha * flick));
      nuc.addColorStop(0.55, rgba(P.ring, 0.3 * P.alpha * flick));
      nuc.addColorStop(1, rgba(P.ring, 0));
      ctx.fillStyle = nuc;
      ctx.beginPath();
      ctx.arc(c, c, nr * 2.4, 0, Math.PI * 2);
      ctx.fill();
      const flareLen = R * 1.9;
      const flare = ctx.createLinearGradient(c - flareLen, c, c + flareLen, c);
      flare.addColorStop(0, rgba(P.ring, 0));
      flare.addColorStop(0.5, rgba(WHITE, 0.5 * P.alpha * flick));
      flare.addColorStop(1, rgba(P.ring, 0));
      ctx.fillStyle = flare;
      ctx.fillRect(c - flareLen, c - R * 0.014, flareLen * 2, R * 0.028);

      // orbits + satellites — back pass, then front pass for occlusion
      const speed = (0.5 + smoothLoad * 1.6) * P.spinMul;
      const satAngle = (i: number) => {
        const o = ORBITS[i % ORBITS.length];
        const wrap = Math.floor(i / ORBITS.length);
        return o.phase + i * 1.9 + wrap * 0.9 + (reduce ? o.phase * 2 : t * speed * o.rate);
      };

      const drawOrbit = (o: Hoop, front: boolean) => {
        ctx.beginPath();
        let pen = false;
        for (let s = 0; s <= STEPS; s += 1) {
          const q = project(hoopPoint(o, (s / STEPS) * Math.PI * 2));
          const on = front ? q.z >= 0 : q.z < 0;
          if (on) {
            if (pen) ctx.lineTo(q.sx, q.sy);
            else ctx.moveTo(q.sx, q.sy);
            pen = true;
          } else if (pen) {
            ctx.lineTo(q.sx, q.sy);
            pen = false;
          }
        }
        const col = o.gold ? P.ring : P.glow;
        ctx.strokeStyle = rgba(col, (front ? (o.gold ? 0.5 : 0.38) : (o.gold ? 0.14 : 0.11)) * P.alpha);
        ctx.lineWidth = Math.max(1, w * 0.0028);
        ctx.stroke();
      };

      const drawSat = (i: number, frontOnly: boolean) => {
        const fade = satFade[i];
        if (fade <= 0.02) return;
        const o = ORBITS[i % ORBITS.length];
        const a = satAngle(i);
        const q = project(hoopPoint(o, a));
        if ((q.z >= 0) !== frontOnly) return;
        const col = o.gold ? P.ring : P.glow;
        // trail — arc behind the satellite, alpha falling off from the head
        const TRAIL = 0.85;
        const segs = 10;
        for (let s = 0; s < segs; s += 1) {
          const a0 = a - (TRAIL * (s + 1)) / segs;
          const a1 = a - (TRAIL * s) / segs;
          const p0 = project(hoopPoint(o, (a0 + a1) / 2));
          const k = 1 - s / segs;
          ctx.beginPath();
          ctx.arc(p0.sx, p0.sy, Math.max(0.6, w * 0.004 * k), 0, Math.PI * 2);
          ctx.fillStyle = rgba(col, 0.28 * k * k * fade * P.alpha * (p0.z >= 0 ? 1 : 0.3));
          ctx.fill();
        }
        const r = w * (q.z >= 0 ? 0.016 : 0.011);
        const alpha = (q.z >= 0 ? 1 : 0.34) * fade * P.alpha;
        const g = ctx.createRadialGradient(q.sx - r * 0.35, q.sy - r * 0.35, 0, q.sx, q.sy, r * 3.2);
        g.addColorStop(0, rgba(WHITE, 0.95 * alpha));
        g.addColorStop(0.3, rgba(col, 0.8 * alpha));
        g.addColorStop(1, rgba(col, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, r * 3.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = rgba(WHITE, 0.9 * alpha);
        ctx.fill();
      };

      for (const front of [false, true]) {
        for (const o of ORBITS) drawOrbit(o, front);
        for (let i = 0; i < satFade.length; i += 1) drawSat(i, front);
        // sparkles ride the same passes: dim behind, bright in front
        for (const sp of SPARKS) {
          const q = project(sp.p);
          if ((q.z >= 0) !== front) continue;
          const tw = reduce ? 0.6 : Math.max(0, Math.sin(t * sp.hz * Math.PI + sp.ph)) ** 2;
          const a = tw * (front ? 0.75 : 0.22) * P.alpha * flick;
          if (a <= 0.02) continue;
          ctx.beginPath();
          ctx.arc(q.sx, q.sy, Math.max(0.7, w * 0.0022), 0, Math.PI * 2);
          ctx.fillStyle = rgba(sp.gold ? P.ring : P.glow, a);
          ctx.fill();
        }
      }
    };

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      draw(now);
    };
    if (reduce) {
      // Nothing moves by itself; the loop only exists to service drags and
      // telemetry changes, and it skips the paint when neither happened.
      draw(performance.now());
      raf = requestAnimationFrame(loop);
    } else {
      raf = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', fit);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endDrag);
      canvas.removeEventListener('pointercancel', endDrag);
      canvas.removeEventListener('keydown', onKeyDown);
    };
  }, [size]);

  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      tabIndex={0}
      role="img"
      aria-roledescription="интерактивная модель"
      aria-label={
        processes == null
          ? 'Модель ядра: орбиты вокруг светящейся сферы. Число процессов не известно — спутников нет. Вращать мышью или стрелками.'
          : processes <= 0
            ? 'Модель ядра: орбиты вокруг светящейся сферы. Активных процессов нет. Вращать мышью или стрелками.'
            : `Модель ядра: сфера-спутник на каждый активный процесс: ${processes}. Вращать мышью или стрелками.`
      }
      data-state={state}
      style={{ width: size, height: size }}
    />
  );
}
