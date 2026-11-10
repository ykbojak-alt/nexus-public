'use client';

import type { ClipboardEvent as ReactClipboardEvent, CSSProperties, DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MutableRefObject, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useVoiceUi } from './voice-ui';
import dynamic from 'next/dynamic';
import { GlassPanel, LoadingState, PanelHeader, StatusBadge, type NexusStatus } from '@nexus/ui';
import {
  BridgeUnavailable,
  createCoreBridge,
  type LiveAgent,
  type LiveEvent,
  type LiveSpace,
  type LiveTerminal,
  type NewfBridge,
} from './newf-live';
import type { ModData } from './newf-mods';
import FloatingPane, { DEFAULT_RECT, type FloatRect } from './newf-float-pane';
import { useZIndex } from './newf-zorder';
import { ShortcutHelp } from './newf-shortcuts';
import { seatSpec } from './newf-roles';
import { renderAnsiScreen } from './newf-screen';
import { useLiveTerminalScreen } from './newf-render-hook';
import { NewfGpuScreenLazy } from './newf-gpu-screen-lazy';
import styles from './newf.module.css';

// UI-5: newf-mods (48 КБ) — тяжёлый экран, грузится лениво только когда
// layout содержит мод-контент. Fallback повторяет регион «Workspace chrome»,
// чтобы первый фрейм сохранял контракт a11y (регион загружается сразу).
const NewfModLazy = dynamic(() => import('./newf-mods').then((m) => m.NewfMod), {
  loading: () => (
    <section role="region" aria-label="Workspace chrome" data-state="loading">
      <LoadingState>Загрузка мода…</LoadingState>
    </section>
  ),
});

export type HerdrLayoutContent =
  | { kind: 'mod'; name: string; props?: Record<string, unknown> }
  | { kind: 'terminal'; address: string }
  | { kind: 'tab'; tab: string; pane?: Record<string, unknown> }
  | { kind: 'agent'; agent: string };

export interface HerdrLayoutDivider {
  width?: number;
  color?: string;
}
export interface HerdrLayoutBorder {
  width?: number;
  color?: string;
}
export type HerdrLayoutBackground =
  | string
  | { gradient: { from: string; to: string; angle?: number } }
  | { image: string; fit?: 'cover' | 'contain' | 'fill' };

export interface HerdrLayoutLook {
  theme?: string;
  colors?: Record<string, string>;
  font?: string;
  font_size?: number;
  terminal_padding?: number;
  ui_font?: string;
  terminal_opacity?: number;
}

export interface HerdrLayoutNode {
  id: string;
  type: 'row' | 'column' | 'stack' | 'block';
  children?: HerdrLayoutNode[];
  content?: HerdrLayoutContent;
  active?: string;
  size?: { px?: number; weight?: number };
  min?: number;
  max?: number;
  padding?: number | [number, number];
  gap?: number;
  resizable?: boolean;
  movable?: boolean;
  hidden?: boolean;
  divider?: HerdrLayoutDivider;
  border?: HerdrLayoutBorder;
  radius?: number;
  shadow?: 'sm' | 'md' | 'lg';
  background?: HerdrLayoutBackground;
  header?: { content: HerdrLayoutContent };
  look?: HerdrLayoutLook;
}

interface MockSpace {
  id: string;
  name: string;
  machine: string;
}

interface MockTerminal {
  address: string;
  label: string;
  spaceId: string;
  tab: string;
  state: 'working' | 'idle' | 'blocked' | 'done';
  preview: string;
  seat?: string;
  parent?: string;
}

interface MockAgent {
  id: string;
  name: string;
  terminal: string;
  status: MockTerminal['state'];
  seat?: string;
  parent?: string;
}

const FIXTURES: {
  spaces: MockSpace[];
  terminals: MockTerminal[];
  agents: MockAgent[];
} = {
  spaces: [
    { id: 'local', name: 'Local workspace', machine: 'This machine' },
    { id: 'sage', name: 'Sage worker', machine: 'remote-host' },
    { id: 'roy', name: 'Roy worker', machine: 'roy2' },
  ],
  terminals: [
    { address: 'mock-local-01', label: 'AGENT-A · orchestration', spaceId: 'local', tab: 'active', state: 'working', preview: 'Planning tasks…', seat: 'orchestrator' },
    { address: 'mock-sage-01', label: 'ROLE-2 · implementation', spaceId: 'sage', tab: 'review', state: 'idle', preview: 'Waiting for a fixture task.', seat: 'coder-1' },
    { address: 'mock-roy-01', label: 'ROLE-1 · patches', spaceId: 'roy', tab: 'review', state: 'blocked', preview: 'Waiting for a fixture dependency.', seat: 'coder-2' },
    { address: 'mock-local-02', label: 'ROLE-4 · verify', spaceId: 'local', tab: 'review', state: 'idle', preview: 'Ready to verify.', seat: 'reviewer' },
    { address: 'mock-local-03', label: 'AGENT-B · short tasks', spaceId: 'local', tab: 'review', state: 'done', preview: 'Short wave done.', seat: 'short' },
    { address: 'mock-sub-01', label: 'OpenCode · sub-agent', spaceId: 'local', tab: 'active', state: 'working', preview: 'Sub-wave in progress.', parent: 'mock-local-01' },
    { address: 'mock-sub-02', label: 'forge-r · sub-agent', spaceId: 'sage', tab: 'review', state: 'idle', preview: 'Idle sub-agent.', parent: 'mock-sage-01' },
  ],
  agents: [
    { id: 'alice', name: 'AGENT-A', terminal: 'mock-local-01', status: 'working', seat: 'orchestrator' },
    { id: 'forge', name: 'ROLE-2', terminal: 'mock-sage-01', status: 'idle', seat: 'coder-1' },
    { id: 'codex', name: 'ROLE-1', terminal: 'mock-roy-01', status: 'blocked', seat: 'coder-2' },
    { id: 'qoder', name: 'ROLE-4', terminal: 'mock-local-02', status: 'idle', seat: 'reviewer' },
    { id: 'ace', name: 'AGENT-B', terminal: 'mock-local-03', status: 'done', seat: 'short' },
    { id: 'sub-opencode', name: 'OpenCode', terminal: 'mock-sub-01', status: 'working', parent: 'mock-local-01' },
    { id: 'sub-forge-r', name: 'forge-r', terminal: 'mock-sub-02', status: 'idle', parent: 'mock-sage-01' },
  ],
};

/** Fixture-backed mock bridge (by design, no I/O). */
export const mockHcBridge = {
  spaces: () => FIXTURES.spaces.map((space) => ({ ...space })),
  terminals: () => FIXTURES.terminals.map((terminal) => ({ ...terminal })),
  agents: () => FIXTURES.agents.map((agent) => ({ ...agent })),
};

const DEFAULT_LAYOUT_JSON = JSON.stringify({
  id: 'root',
  type: 'row',
  gap: 12,
  padding: 12,
  resizable: false,
  children: [
    {
      id: 'sidebar',
      type: 'column',
      size: { px: 268 },
      min: 220,
      max: 360,
      gap: 8,
      children: [
        { id: 'brand', type: 'block', size: { px: 54 }, content: { mod: 'workspace-chrome' } },
        { id: 'spaces', type: 'block', size: { weight: 1 }, min: 140, content: { mod: 'spaces' } },
        { id: 'agents', type: 'block', size: { weight: 1 }, min: 150, content: { mod: 'agents' } },
      ],
    },
    {
      id: 'workspace',
      type: 'column',
      size: { weight: 1 },
      min: 0,
      gap: 8,
      children: [
        { id: 'tabs', type: 'block', size: { px: 46 }, content: { mod: 'tabs' } },
        {
          id: 'work-body',
          type: 'row',
          size: { weight: 1 },
          min: 0,
          gap: 8,
          children: [
            { id: 'active-tab', type: 'block', size: { weight: 2 }, min: 0, content: { tab: 'active', pane: { gap: 8, radius: 10 } } },
            {
              id: 'side-panel',
              type: 'stack',
              size: { px: 280 },
              min: 240,
              max: 420,
              active: 'changes',
              children: [
                { id: 'files', type: 'block', content: { mod: 'files' } },
                { id: 'changes', type: 'block', content: { mod: 'changes' } },
                { id: 'nexuslink', type: 'block', content: { mod: 'nexuslink' } },
                { id: 'nexustick', type: 'block', content: { mod: 'nexustick' } },
                { id: 'sysmon', type: 'block', content: { mod: 'sysmon' } },
                { id: 'machine-add', type: 'block', content: { mod: 'machine-add' } },
                { id: 'new-menu', type: 'block', content: { mod: 'new-menu' } },
              ],
            },
          ],
        },
        { id: 'status', type: 'block', size: { px: 34 }, content: { mod: 'workspace-status' } },
      ],
    },
  ],
});

const NODE_TYPES = new Set<HerdrLayoutNode['type']>(['row', 'column', 'stack', 'block']);
const CONTENT_TYPES = ['mod', 'terminal', 'tab', 'agent'] as const;
const MAX_NODES = 256;
const MAX_DEPTH = 32;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown, field: string, nodeId: string, min = 0): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
    throw new Error(`Invalid ${field} for layout node ${nodeId}`);
  }
  return value;
}

function parseDivider(value: unknown, nodeId: string): HerdrLayoutDivider | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid divider for layout node ${nodeId}`);
  const width = finiteNumber(value.width, 'divider.width', nodeId);
  if (value.color !== undefined && (typeof value.color !== 'string' || value.color.trim().length === 0)) {
    throw new Error(`Invalid divider.color for layout node ${nodeId}`);
  }
  return {
    ...(width !== undefined ? { width } : {}),
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
  };
}

function parseBorder(value: unknown, nodeId: string): HerdrLayoutBorder | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid border for layout node ${nodeId}`);
  const width = finiteNumber(value.width, 'border.width', nodeId);
  if (value.color !== undefined && (typeof value.color !== 'string' || value.color.trim().length === 0)) {
    throw new Error(`Invalid border.color for layout node ${nodeId}`);
  }
  return {
    ...(width !== undefined ? { width } : {}),
    ...(typeof value.color === 'string' ? { color: value.color } : {}),
  };
}

const BACKGROUND_FITS = ['cover', 'contain', 'fill'] as const;

/** Gradient as array: [from, to] or [from, to, angle]. herdr-layouts могут писать так. */
function parseGradientArray(value: unknown[], field: string, nodeId: string): { from: string; to: string; angle?: number } {
  const n = value.length;
  if (n < 2 || n > 3) {
    throw new Error(`Invalid ${field} for layout node ${nodeId} (expected [from, to] or [from, to, angle])`);
  }
  if (typeof value[0] !== 'string' || typeof value[1] !== 'string') {
    throw new Error(`Invalid ${field} for layout node ${nodeId}`);
  }
  const angle = n === 3 ? finiteNumber(value[2], `${field}.angle`, nodeId, -360) : undefined;
  return { from: value[0], to: value[1], ...(angle !== undefined ? { angle } : {}) };
}

function parseBackground(value: unknown, nodeId: string): HerdrLayoutBackground | undefined {
  if (value === undefined) return undefined;
  if (typeof value === 'string') {
    if (value.trim().length === 0) throw new Error(`Invalid background for layout node ${nodeId}`);
    return value;
  }
  if (Array.isArray(value)) {
    // Bare array: [from, to] or [from, to, angle].
    return { gradient: parseGradientArray(value, 'background', nodeId) };
  }
  if (!isRecord(value)) throw new Error(`Invalid background for layout node ${nodeId}`);
  const isRecordWith = (key: string) => isRecord(value[key]);
  if (isRecordWith('gradient')) {
    const gradient = value.gradient as Record<string, unknown>;
    if (typeof gradient.from !== 'string' || typeof gradient.to !== 'string') {
      throw new Error(`Invalid background.gradient for layout node ${nodeId}`);
    }
    const angle = finiteNumber(gradient.angle, 'background.gradient.angle', nodeId, -360);
    return { gradient: { from: gradient.from, to: gradient.to, ...(angle !== undefined ? { angle } : {}) } };
  }
  if (Array.isArray(value.gradient)) {
    // gradient как массив: { gradient: [from, to, angle?], angle? }.
    const grad = parseGradientArray(value.gradient, 'background.gradient', nodeId);
    const angle = value.angle !== undefined ? finiteNumber(value.angle, 'background.angle', nodeId, -360) : grad.angle;
    return { gradient: { from: grad.from, to: grad.to, ...(angle !== undefined ? { angle } : {}) } };
  }
  if (typeof value.image === 'string') {
    if (value.image.trim().length === 0) throw new Error(`Invalid background.image for layout node ${nodeId}`);
    let fit: 'cover' | 'contain' | 'fill' | undefined;
    if (value.fit !== undefined) {
      if (typeof value.fit !== 'string' || !(BACKGROUND_FITS as readonly string[]).includes(value.fit)) {
        throw new Error(`Invalid background.fit for layout node ${nodeId}`);
      }
      fit = value.fit as 'cover' | 'contain' | 'fill';
    }
    return { image: value.image, ...(fit ? { fit } : {}) };
  }
  if (isRecordWith('image')) {
    const image = value.image as Record<string, unknown>;
    if (typeof image.src !== 'string' || image.src.trim().length === 0) {
      throw new Error(`Invalid background.image for layout node ${nodeId}`);
    }
    let fit: 'cover' | 'contain' | 'fill' | undefined;
    if (image.fit !== undefined) {
      if (typeof image.fit !== 'string' || !(BACKGROUND_FITS as readonly string[]).includes(image.fit)) {
        throw new Error(`Invalid background.image.fit for layout node ${nodeId}`);
      }
      fit = image.fit as 'cover' | 'contain' | 'fill';
    }
    return { image: image.src, ...(fit ? { fit } : {}) };
  }
  throw new Error(`Invalid background for layout node ${nodeId}`);
}

function parseShadow(value: unknown, nodeId: string): HerdrLayoutNode['shadow'] {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !['sm', 'md', 'lg'].includes(value)) {
    throw new Error(`Invalid shadow for layout node ${nodeId}`);
  }
  return value as HerdrLayoutNode['shadow'];
}

function parseHeader(value: unknown, nodeId: string): HerdrLayoutNode['header'] {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !isRecord(value.content) || !Object.hasOwn(value.content, 'mod')) {
    throw new Error(`Invalid header for layout node ${nodeId} (expected content.mod)`);
  }
  const node = { id: `${nodeId}.header`, type: 'block' as const, content: undefined as HerdrLayoutContent | undefined };
  try {
    node.content = parseContent(value.content, node.id);
  } catch (error) {
    throw new Error(`Invalid header content for layout node ${nodeId}: ${error instanceof Error ? error.message : 'parse failed'}`);
  }
  return { content: node.content };
}

const LOOK_THEMES = ['light', 'dark', 'graphite', 'ink', 'moss', 'paper'];

function parseLook(value: unknown, nodeId: string): HerdrLayoutLook | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid look for layout node ${nodeId}`);
  const look: HerdrLayoutLook = {};
  if (value.theme !== undefined) {
    if (typeof value.theme !== 'string' || !LOOK_THEMES.includes(value.theme)) {
      throw new Error(`Invalid look.theme for layout node ${nodeId}`);
    }
    look.theme = value.theme;
  }
  if (value.colors !== undefined) {
    if (!isRecord(value.colors)) throw new Error(`Invalid look.colors for layout node ${nodeId}`);
    const colors: Record<string, string> = {};
    for (const [key, color] of Object.entries(value.colors)) {
      if (typeof color !== 'string' || color.trim().length === 0) {
        throw new Error(`Invalid look.colors.${key} for layout node ${nodeId}`);
      }
      colors[key] = color;
    }
    look.colors = colors;
  }
  if (value.font !== undefined) {
    if (typeof value.font !== 'string' || value.font.trim().length === 0) {
      throw new Error(`Invalid look.font for layout node ${nodeId}`);
    }
    look.font = value.font;
  }
  if (value.font_size !== undefined) {
    const size = finiteNumber(value.font_size, 'look.font_size', nodeId, 1);
    look.font_size = size;
  }
  if (value.terminal_padding !== undefined) {
    const pad = finiteNumber(value.terminal_padding, 'look.terminal_padding', nodeId);
    look.terminal_padding = pad;
  }
  if (value.ui_font !== undefined) {
    if (typeof value.ui_font !== 'string' || value.ui_font.trim().length === 0) {
      throw new Error(`Invalid look.ui_font for layout node ${nodeId}`);
    }
    look.ui_font = value.ui_font;
  }
  if (value.terminal_opacity !== undefined) {
    const opacity = finiteNumber(value.terminal_opacity, 'look.terminal_opacity', nodeId, 0);
    if (opacity !== undefined && opacity > 1) throw new Error(`Invalid look.terminal_opacity for layout node ${nodeId} (0..1)`);
    if (opacity !== undefined) look.terminal_opacity = opacity;
  }
  return Object.keys(look).length ? look : undefined;
}

/** Каскад наследования look: наследуемый мержится с локальным (локальный побеждает). */
export function mergeLook(inherited: HerdrLayoutLook | undefined, local: HerdrLayoutLook | undefined): HerdrLayoutLook | undefined {
  if (!inherited && !local) return undefined;
  return {
    ...(inherited ?? {}),
    ...(local ?? {}),
    colors: { ...(inherited?.colors ?? {}), ...(local?.colors ?? {}) },
  };
}

function parseContent(value: unknown, nodeId: string): HerdrLayoutContent {
  if (!isRecord(value)) throw new Error(`Missing content object for layout block ${nodeId}`);
  const present = CONTENT_TYPES.filter((key) => Object.hasOwn(value, key));
  if (present.length !== 1) throw new Error(`Layout block ${nodeId} must have exactly one content type`);
  const kind = present[0];
  const payload = value[kind];
  if (typeof payload !== 'string' || payload.trim().length === 0) {
    throw new Error(`Invalid ${kind} content for layout block ${nodeId}`);
  }
  if (kind === 'mod') {
    if (value.props !== undefined && !isRecord(value.props)) throw new Error(`Invalid props for layout mod ${nodeId}`);
    return { kind, name: payload, ...(value.props ? { props: value.props } : {}) };
  }
  if (kind === 'terminal') return { kind, address: payload };
  if (kind === 'tab') {
    if (value.pane !== undefined && !isRecord(value.pane)) throw new Error(`Invalid pane options for layout tab ${nodeId}`);
    return { kind, tab: payload, ...(value.pane ? { pane: value.pane } : {}) };
  }
  return { kind, agent: payload };
}

/** Parses the supported Herdr layout JSON subset used by NEWF E1. */
export function parseHerdrLayout(source: string): HerdrLayoutNode {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid layout JSON: ${error instanceof Error ? error.message : 'parse failed'}`);
  }

  const seen = new Set<string>();
  let count = 0;
  const parseNode = (raw: unknown, depth: number): HerdrLayoutNode => {
    if (depth > MAX_DEPTH) throw new Error(`Layout exceeds maximum depth ${MAX_DEPTH}`);
    if (!isRecord(raw)) throw new Error('Every layout node must be an object');
    count += 1;
    if (count > MAX_NODES) throw new Error(`Layout exceeds maximum node count ${MAX_NODES}`);
    if (typeof raw.id !== 'string' || raw.id.trim().length === 0) throw new Error('Every layout node needs a non-empty id');
    if (seen.has(raw.id)) throw new Error(`Duplicate layout node id: ${raw.id}`);
    seen.add(raw.id);
    if (typeof raw.type !== 'string' || !NODE_TYPES.has(raw.type as HerdrLayoutNode['type'])) {
      throw new Error(`Unsupported layout node type at ${raw.id}`);
    }

    const type = raw.type as HerdrLayoutNode['type'];
    const min = finiteNumber(raw.min, 'min', raw.id);
    const max = finiteNumber(raw.max, 'max', raw.id);
    if (min !== undefined && max !== undefined && min > max) throw new Error(`Layout node ${raw.id} has min greater than max`);
    let size: HerdrLayoutNode['size'];
    if (raw.size !== undefined) {
      if (!isRecord(raw.size)) throw new Error(`Invalid size for layout node ${raw.id}`);
      const px = finiteNumber(raw.size.px, 'size.px', raw.id);
      const weight = finiteNumber(raw.size.weight, 'size.weight', raw.id, Number.MIN_VALUE);
      if ((px === undefined) === (weight === undefined)) throw new Error(`Layout node ${raw.id} size needs exactly one of px or weight`);
      size = px !== undefined ? { px } : { weight };
    }
    const paddingValue = raw.padding;
    let padding: HerdrLayoutNode['padding'];
    if (paddingValue !== undefined) {
      if (Array.isArray(paddingValue) && paddingValue.length === 2) {
        padding = [
          finiteNumber(paddingValue[0], 'padding', raw.id)!,
          finiteNumber(paddingValue[1], 'padding', raw.id)!,
        ];
      } else {
        const single = finiteNumber(paddingValue, 'padding', raw.id);
        if (single === undefined) throw new Error(`Invalid padding for layout node ${raw.id}`);
        padding = single;
      }
    }
    const gap = finiteNumber(raw.gap, 'gap', raw.id);
    for (const flag of ['hidden', 'resizable', 'movable'] as const) {
      if (raw[flag] !== undefined && typeof raw[flag] !== 'boolean') throw new Error(`Invalid ${flag} for layout node ${raw.id}`);
    }
    if (raw.active !== undefined && typeof raw.active !== 'string') throw new Error(`Invalid active child for layout node ${raw.id}`);

    const divider = parseDivider(raw.divider, raw.id);
    const border = parseBorder(raw.border, raw.id);
    const radius = finiteNumber(raw.radius, 'radius', raw.id);
    const shadow = parseShadow(raw.shadow, raw.id);
    const background = parseBackground(raw.background, raw.id);
    if (raw.header !== undefined && type !== 'stack') {
      throw new Error(`Only stack nodes can have header (${raw.id})`);
    }
    const header = type === 'stack' ? parseHeader(raw.header, raw.id) : undefined;
    const look = parseLook(raw.look, raw.id);

    let children: HerdrLayoutNode[] | undefined;
    if (type === 'block') {
      if (raw.children !== undefined) throw new Error(`Layout block ${raw.id} cannot have children`);
    } else {
      if (!Array.isArray(raw.children)) throw new Error(`Layout ${type} ${raw.id} needs a children array`);
      children = raw.children.map((child) => parseNode(child, depth + 1));
      if (type === 'stack' && typeof raw.active === 'string' && !children.some((child) => child.id === raw.active)) {
        throw new Error(`Active stack child ${raw.active} is missing from ${raw.id}`);
      }
    }
    const content = type === 'block' ? parseContent(raw.content, raw.id) : undefined;
    if (type !== 'block' && raw.content !== undefined) throw new Error(`Only block nodes can have content (${raw.id})`);

    return {
      id: raw.id,
      type,
      ...(children ? { children } : {}),
      ...(content ? { content } : {}),
      ...(typeof raw.active === 'string' ? { active: raw.active } : {}),
      ...(size ? { size } : {}),
      ...(min !== undefined ? { min } : {}),
      ...(max !== undefined ? { max } : {}),
      ...(padding !== undefined ? { padding } : {}),
      ...(gap !== undefined ? { gap } : {}),
      ...(typeof raw.resizable === 'boolean' ? { resizable: raw.resizable } : {}),
      ...(typeof raw.movable === 'boolean' ? { movable: raw.movable } : {}),
      ...(typeof raw.hidden === 'boolean' ? { hidden: raw.hidden } : {}),
      ...(divider ? { divider } : {}),
      ...(border ? { border } : {}),
      ...(radius !== undefined ? { radius } : {}),
      ...(shadow ? { shadow } : {}),
      ...(background ? { background } : {}),
      ...(header ? { header } : {}),
      ...(look ? { look } : {}),
    };
  };

  return parseNode(value, 0);
}

const AGENT_STATUS: Record<MockAgent['status'], { status: NexusStatus; label: string }> = {
  working: { status: 'active', label: 'working' },
  idle: { status: 'paused', label: 'idle' },
  blocked: { status: 'warning', label: 'blocked' },
  done: { status: 'complete', label: 'done' },
};

/** OSC 7501 (5 состояний) → StatusBadge. */
export const OSC_BADGE: Record<string, { status: NexusStatus }> = {
  working: { status: 'active' },
  idle: { status: 'paused' },
  done: { status: 'complete' },
  blocked: { status: 'warning' },
  error: { status: 'warning' },
};

function shadowToCss(shadow: NonNullable<HerdrLayoutNode['shadow']>): string {
  switch (shadow) {
    case 'sm': return '0 1px 2px rgba(0,0,0,.28)';
    case 'md': return '0 4px 12px rgba(0,0,0,.30)';
    case 'lg': return '0 10px 28px rgba(0,0,0,.36)';
  }
}

function backgroundToCss(background: NonNullable<HerdrLayoutNode['background']>): string {
  if (typeof background === 'string') return background;
  if ('gradient' in background) {
    const { from, to, angle } = background.gradient;
    return `linear-gradient(${angle ?? 180}deg, ${from}, ${to})`;
  }
  // { image, fit }: путь резолвится как есть (локальный/публичный URL); fit — через backgroundSize.
  return `url(${background.image}) center / ${background.fit ?? 'cover'} no-repeat`;
}

function lookCssVars(look: HerdrLayoutLook | undefined): CSSProperties {
  if (!look?.colors) return {};
  const vars: Record<string, string> = {};
  for (const [key, color] of Object.entries(look.colors)) vars[`--look-${key}`] = color;
  return vars as CSSProperties;
}

function nodeStyle(node: HerdrLayoutNode, parentAxis: 'row' | 'column' | undefined, look?: HerdrLayoutLook): CSSProperties {
  const padding = node.padding;
  const uiFont = look?.ui_font ?? node.look?.font ?? look?.font;
  return {
    ...(padding !== undefined ? { padding: Array.isArray(padding) ? `${padding[0]}px ${padding[1]}px` : `${padding}px` } : {}),
    ...(node.min !== undefined && parentAxis === 'row' ? { minWidth: `${node.min}px` } : {}),
    ...(node.min !== undefined && parentAxis === 'column' ? { minHeight: `${node.min}px` } : {}),
    ...(node.max !== undefined && parentAxis === 'row' ? { maxWidth: `${node.max}px` } : {}),
    ...(node.max !== undefined && parentAxis === 'column' ? { maxHeight: `${node.max}px` } : {}),
    ...(node.hidden ? { display: 'none' } : {}),
    ...(node.border ? {
      borderWidth: node.border.width ?? 1,
      borderStyle: 'solid',
      borderColor: node.border.color ?? 'var(--border-subtle)',
    } : {}),
    ...(node.radius !== undefined ? { borderRadius: `${node.radius}px` } : {}),
    ...(node.shadow ? { boxShadow: shadowToCss(node.shadow) } : {}),
    ...(node.background ? { background: backgroundToCss(node.background) } : {}),
    ...(uiFont ? { fontFamily: uiFont } : {}),
    ...(node.look?.font_size !== undefined ? { fontSize: `${node.look.font_size}px` } : {}),
    ...lookCssVars(node.look),
  };
}

function gridTracks(children: HerdrLayoutNode[]): string {
  return children.map((node) => {
    if (node.size?.px !== undefined) {
      const min = node.min ?? node.size.px;
      const max = node.max ?? node.size.px;
      return `minmax(${Math.min(min, max)}px, ${Math.max(min, Math.min(max, node.size.px))}px)`;
    }
    if (node.max !== undefined) return `minmax(${node.min ?? 0}px, ${node.max}px)`;
    return `minmax(${node.min ?? 0}px, ${node.size?.weight ?? 1}fr)`;
  }).join(' ');
}

function updateLayoutNode(
  node: HerdrLayoutNode,
  id: string,
  update: (current: HerdrLayoutNode) => HerdrLayoutNode,
): HerdrLayoutNode {
  if (node.id === id) return update(node);
  if (!node.children) return node;
  const children = node.children.map((child) => updateLayoutNode(child, id, update));
  return children.some((child, index) => child !== node.children?.[index]) ? { ...node, children } : node;
}

function trackSize(node: HerdrLayoutNode, measured: number): number {
  const raw = node.size?.px !== undefined
    ? node.size.px
    : Number.isFinite(measured) && measured > 0
      ? measured
      : (node.size?.weight ?? 1) * 100;
  return Math.max(node.min ?? 0, Math.min(node.max ?? raw, raw));
}

function clampTrackSize(first: HerdrLayoutNode, second: HerdrLayoutNode, total: number, requested: number): number {
  const min = Math.max(first.min ?? 0, second.max === undefined ? 0 : total - second.max);
  const max = Math.min(first.max ?? total, total - (second.min ?? 0));
  return Math.max(min, Math.min(max, requested));
}

type DropEdge = 'left' | 'right' | 'top' | 'bottom' | 'center';
interface PaneDragSource { id: string; splitId: string }
interface LayoutEditorContextValue {
  dragSource: { current: PaneDragSource | null };
  setStackActive: (stackId: string, childId: string) => void;
  resize: (splitId: string, index: number, firstPx: number, secondPx: number) => void;
  movePane: (splitId: string, sourceId: string, targetId: string, edge: DropEdge) => void;
}

const LayoutEditorContext = createContext<LayoutEditorContextValue | null>(null);

/** Keyboard-фокус дерева (roving tabindex): id узла, на котором «живёт» фокус. */
export interface LayoutFocusState { focusedNode?: string; setFocusedNode: (id?: string) => void }
const LayoutFocusContext = createContext<LayoutFocusState | undefined>(undefined);

/** NEWF §4 look-каскад: эффективный look для поддерева (layout→…→pane). */
const LookContext = createContext<HerdrLayoutLook | undefined>(undefined);
export function useLook(): HerdrLayoutLook | undefined {
  return useContext(LookContext);
}

function movePaneInLayout(layout: HerdrLayoutNode, splitId: string, sourceId: string, targetId: string, edge: DropEdge): HerdrLayoutNode {
  if (sourceId === targetId) return layout;
  return updateLayoutNode(layout, splitId, (split) => {
    if ((split.type !== 'row' && split.type !== 'column') || !split.children) return split;
    const sourceIndex = split.children.findIndex((child) => child.id === sourceId);
    const targetIndex = split.children.findIndex((child) => child.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return split;
    if (edge === 'center') {
      const children = [...split.children];
      [children[sourceIndex], children[targetIndex]] = [children[targetIndex], children[sourceIndex]];
      return { ...split, children };
    }

    const source = split.children[sourceIndex];
    const target = split.children[targetIndex];
    const remaining = split.children.filter((child) => child.id !== sourceId);
    const insertionIndex = remaining.findIndex((child) => child.id === targetId);
    const before = edge === 'left' || edge === 'top';
    const nestedIdBase = `split-${targetId}-${sourceId}`;
    const existingIds = new Set<string>();
    const collectIds = (node: HerdrLayoutNode) => {
      existingIds.add(node.id);
      node.children?.forEach(collectIds);
    };
    collectIds(layout);
    let nestedId = nestedIdBase;
    let suffix = 2;
    while (existingIds.has(nestedId)) nestedId = `${nestedIdBase}-${suffix++}`;

    const nested: HerdrLayoutNode = {
      id: nestedId,
      type: edge === 'left' || edge === 'right' ? 'row' : 'column',
      size: target.size ?? { weight: 1 },
      ...(target.min !== undefined ? { min: target.min } : {}),
      ...(target.max !== undefined ? { max: target.max } : {}),
      children: (before ? [source, target] : [target, source]).map((child) => ({ ...child, size: { weight: 1 } })),
    };
    const children = [...remaining];
    children.splice(insertionIndex, 1, nested);
    return { ...split, children };
  });
}

function dropEdgeFor(event: ReactDragEvent<HTMLDivElement>): DropEdge {
  const rect = event.currentTarget.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 'center';
  const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 'center';
  const edges: Array<{ edge: DropEdge; distance: number }> = [
    { edge: 'left', distance: x },
    { edge: 'right', distance: 1 - x },
    { edge: 'top', distance: y },
    { edge: 'bottom', distance: 1 - y },
  ];
  const closest = edges.reduce((best, current) => current.distance < best.distance ? current : best);
  return closest.distance <= 0.24 ? closest.edge : 'center';
}

function LayoutNodeView({ node, parentAxis, parentSplitId, inheritedMovable = true }: {
  node: HerdrLayoutNode;
  parentAxis?: 'row' | 'column';
  parentSplitId?: string;
  inheritedMovable?: boolean;
}) {
  if (node.hidden) return null;
  const editor = useContext(LayoutEditorContext);
  const inheritedLook = useLook();
  const look = mergeLook(inheritedLook, node.look);
  const visibleChildren = (node.children ?? []).filter((child) => !child.hidden);
  const activeStackChild = visibleChildren.find((child) => child.id === node.active) ?? visibleChildren[0];
  const displayedChildren = node.type === 'stack' ? [activeStackChild].filter(Boolean) as HerdrLayoutNode[] : visibleChildren;
  const effectiveMovable = node.movable ?? inheritedMovable;
  const canMovePane = node.type === 'block' && effectiveMovable && parentSplitId !== undefined;
  const interactiveSplit = (node.type === 'row' || node.type === 'column')
    && (node.resizable ?? true)
    && displayedChildren.length > 1;
  const axis = node.type === 'row' || node.type === 'column' ? node.type : undefined;
  const dividerWidth = node.divider?.width ?? 10;
  const dividerColor = node.divider?.color;
  const tracks = (children: HerdrLayoutNode[]) => children.flatMap((child, index) => [
    gridTracks([child]),
    ...(index < children.length - 1 ? [`${dividerWidth}px`] : []),
  ]).join(' ');
  const style: CSSProperties = {
    ...nodeStyle(node, parentAxis, look),
    ...(node.type === 'row' && displayedChildren.length ? { gridTemplateColumns: interactiveSplit ? tracks(displayedChildren) : gridTracks(displayedChildren) } : {}),
    ...(node.type === 'column' && displayedChildren.length ? { gridTemplateRows: interactiveSplit ? tracks(displayedChildren) : gridTracks(displayedChildren) } : {}),
    ...(node.type === 'stack' && displayedChildren.length ? { gridTemplateColumns: 'minmax(0, 1fr)', gridTemplateRows: 'auto minmax(0, 1fr)' } : {}),
    ...(node.gap !== undefined ? { gap: interactiveSplit ? '0' : `${node.gap}px` } : {}),
  };
  const className = node.type === 'row' ? styles.row
    : node.type === 'column' ? styles.column
      : node.type === 'stack' ? styles.stack
        : styles.block;
  const layoutFocus = useContext(LayoutFocusContext);
  const visibleIndex = visibleChildren.findIndex((child) => child.id === layoutFocus?.focusedNode);
  const focusedChildId = visibleIndex >= 0 ? visibleChildren[visibleIndex].id : undefined;
  const isChildFocused = (child: HerdrLayoutNode) => child.id === focusedChildId;
  const focusChild = (child: HerdrLayoutNode) => layoutFocus?.setFocusedNode(child.id);
  const focusNode = () => layoutFocus?.setFocusedNode(node.id);
  const keyboardNavNextNode = () => {
    if (visibleChildren.length === 0) { focusNode(); return; }
    const nextIndex = visibleIndex >= 0 ? (visibleIndex + 1) % visibleChildren.length : 0;
    focusChild(visibleChildren[nextIndex]);
  };
  const keyboardNavPrevNode = () => {
    if (visibleChildren.length === 0) { focusNode(); return; }
    const prevIndex = visibleIndex >= 0 ? (visibleIndex - 1 + visibleChildren.length) % visibleChildren.length : visibleChildren.length - 1;
    focusChild(visibleChildren[prevIndex]);
  };
  const onLayoutKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const isSelfFocused = layoutFocus?.focusedNode === node.id;
    const idInSubtree = (n: HerdrLayoutNode, id?: string): boolean =>
      id === undefined ? false : n.id === id || Boolean(n.children?.some((c) => idInSubtree(c, id)));
    const focusParentNode = () => {
      const parentEl = event.currentTarget.parentElement?.closest('[data-layout-node]');
      if (parentEl) layoutFocus?.setFocusedNode(parentEl.getAttribute('data-layout-node') ?? undefined);
      else layoutFocus?.setFocusedNode(undefined);
    };

    if (event.key === 'Escape') {
      if (isSelfFocused) {
        event.preventDefault();
        event.stopPropagation();
        focusParentNode();
      } else if (idInSubtree(node, layoutFocus?.focusedNode)) {
        event.preventDefault();
        event.stopPropagation();
        layoutFocus?.setFocusedNode(node.id);
      }
      return;
    }

    if (node.type === 'row' || node.type === 'column') {
      const line = node.type === 'row' ? 'ArrowRight' : 'ArrowDown';
      const back = node.type === 'row' ? 'ArrowLeft' : 'ArrowUp';
      const navActive = layoutFocus?.focusedNode === node.id || idInSubtree(node, layoutFocus?.focusedNode);
      if (navActive && (event.key === line || event.key === back)) {
        event.preventDefault();
        event.stopPropagation();
        if (event.key === line) keyboardNavNextNode();
        else keyboardNavPrevNode();
      }
      return;
    }

    if (node.type === 'stack') {
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        const dir = event.key === 'ArrowRight' ? 1 : -1;
        const fromId = focusedChildId ?? node.active ?? visibleChildren[0]?.id;
        const index = visibleChildren.findIndex((child) => child.id === fromId);
        if (index >= 0 && visibleChildren.length > 0) {
          const nextIndex = (index + dir + visibleChildren.length) % visibleChildren.length;
          const nextChildId = visibleChildren[nextIndex].id;
          event.preventDefault();
          event.stopPropagation();
          layoutFocus?.setFocusedNode(nextChildId);
          const tabButton = event.currentTarget.querySelector<HTMLElement>(
            `#newf-tab-${encodeURIComponent(node.id)}-${encodeURIComponent(nextChildId)}`,
          );
          tabButton?.focus();
        }
        return;
      }
      if (event.key === 'Enter' && focusedChildId) {
        event.preventDefault();
        event.stopPropagation();
        if (focusedChildId !== node.active) editor?.setStackActive(node.id, focusedChildId);
      }
    }
  };
  const layoutTabIndex = layoutFocus
    ? layoutFocus.focusedNode === node.id || isChildFocused(node)
      ? 0
      : layoutFocus.focusedNode === undefined && node.type === 'stack'
        ? 0
        : -1
    : node.type === 'stack' ? 0 : undefined;
  const onDragStart = (event: ReactDragEvent<HTMLDivElement>) => {
    if (node.type !== 'block' || !effectiveMovable || !parentSplitId || !editor) {
      event.preventDefault();
      return;
    }
    editor.dragSource.current = { id: node.id, splitId: parentSplitId };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', node.id);
    }
  };
  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (node.type !== 'block' || !effectiveMovable || !parentSplitId || !editor) return;
    event.preventDefault();
    const source = editor.dragSource.current;
    editor.dragSource.current = null;
    if (source?.splitId === parentSplitId) editor.movePane(parentSplitId, source.id, node.id, dropEdgeFor(event));
  };

  const childrenWithDividers = displayedChildren.flatMap((child, index) => {
    const result: ReactNode[] = [
      <LayoutNodeView
        key={child.id}
        node={child}
        parentAxis={axis}
        parentSplitId={axis ? node.id : undefined}
        inheritedMovable={effectiveMovable}
      />,
    ];
    if (interactiveSplit && index < displayedChildren.length - 1 && axis && editor) {
      const next = displayedChildren[index + 1];
      result.push(
        <ResizeDivider
          key={`divider-${node.id}-${child.id}-${next.id}`}
          splitId={node.id}
          axis={axis}
          index={index}
          first={child}
          second={next}
          onResize={editor.resize}
          dividerColor={dividerColor}
        />,
      );
    }
    return result;
  });

  return (
    <LookContext.Provider value={look}>
      <div
        className={`${className}${interactiveSplit ? ` ${styles.resizable}` : ''}`}
        style={style}
        data-layout-node={node.id}
        data-testid={`newf-layout-node-${node.id}`}
        data-layout-type={node.type}
        data-layout-focused={layoutFocus?.focusedNode === node.id ? 'true' : undefined}
        data-size-px={node.size?.px}
        data-resizable={node.resizable ?? (node.type === 'row' || node.type === 'column')}
        data-movable={effectiveMovable}
        draggable={canMovePane}
        tabIndex={layoutTabIndex}
        onKeyDown={onLayoutKeyDown}
        onFocus={(event) => {
          if (layoutFocus && event.target === event.currentTarget && layoutFocus.focusedNode !== node.id) {
            layoutFocus.setFocusedNode(node.id);
          }
        }}
        onDragStart={onDragStart}
        onDragOver={(event) => {
          if (node.type === 'block' && effectiveMovable && parentSplitId && editor?.dragSource.current?.splitId === parentSplitId) event.preventDefault();
        }}
        onDrop={onDrop}
        onDragEnd={() => {
          if (editor?.dragSource.current?.id === node.id) editor.dragSource.current = null;
        }}
      >
        {node.type === 'block' && node.content ? <LayoutContent content={node.content} /> : node.type === 'stack' ? (
          <>
            {node.header ? (
              <div className={styles.stackHeader} data-stack-header>
                <LayoutContent content={node.header.content} />
              </div>
            ) : (
              <div className={styles.stackTabs} role="tablist" aria-label={`Layout tabs ${node.id}`}>
                {visibleChildren.map((child) => (
                  <button
                    key={child.id}
                    id={`newf-tab-${encodeURIComponent(node.id)}-${encodeURIComponent(child.id)}`}
                    type="button"
                    role="tab"
                    aria-selected={activeStackChild?.id === child.id}
                    aria-controls={`newf-panel-${encodeURIComponent(node.id)}`}
                    tabIndex={activeStackChild?.id === child.id ? 0 : -1}
                    onClick={() => editor?.setStackActive(node.id, child.id)}
                  >
                    {child.id}
                  </button>
                ))}
              </div>
            )}
            {activeStackChild && (
              <div
                id={`newf-panel-${encodeURIComponent(node.id)}`}
                className={styles.stackPanel}
                role="tabpanel"
                aria-labelledby={`newf-tab-${encodeURIComponent(node.id)}-${encodeURIComponent(activeStackChild.id)}`}
                tabIndex={0}
              >
                <LayoutNodeView node={activeStackChild} inheritedMovable={effectiveMovable} />
              </div>
            )}
          </>
        ) : childrenWithDividers}
      </div>
    </LookContext.Provider>
  );
}

function ResizeDivider({ splitId, axis, index, first, second, onResize, dividerColor }: {
  splitId: string;
  axis: 'row' | 'column';
  index: number;
  first: HerdrLayoutNode;
  second: HerdrLayoutNode;
  onResize: LayoutEditorContextValue['resize'];
  dividerColor?: string;
}) {
  const dragRef = useRef<{ start: number; first: number; second: number; total: number } | null>(null);
  const vertical = axis === 'row';
  const readSizes = (element: HTMLButtonElement) => {
    const parent = element.parentElement;
    const children = Array.from(parent?.children ?? []).filter((child) => child.hasAttribute('data-layout-node'));
    const firstRect = children.find((child) => child.getAttribute('data-layout-node') === first.id)?.getBoundingClientRect();
    const secondRect = children.find((child) => child.getAttribute('data-layout-node') === second.id)?.getBoundingClientRect();
    const firstSize = trackSize(first, firstRect ? (vertical ? firstRect.width : firstRect.height) : 0);
    const secondSize = trackSize(second, secondRect ? (vertical ? secondRect.width : secondRect.height) : 0);
    return { firstSize, secondSize, total: firstSize + secondSize };
  };
  const initialTotal = trackSize(first, 0) + trackSize(second, 0);
  const initialNow = trackSize(first, 0);
  const initialMin = Math.max(first.min ?? 0, second.max === undefined ? 0 : initialTotal - second.max);
  const initialMax = Math.min(first.max ?? initialTotal, initialTotal - (second.min ?? 0));

  const applyPointerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const coordinate = vertical ? event.clientX : event.clientY;
    if (!Number.isFinite(coordinate)) return;
    const next = clampTrackSize(first, second, drag.total, drag.first + coordinate - drag.start);
    onResize(splitId, index, next, drag.total - next);
  };
  const startPointerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const coordinate = vertical ? event.clientX : event.clientY;
    if (!Number.isFinite(coordinate)) return;
    const { firstSize, secondSize, total } = readSizes(event.currentTarget);
    dragRef.current = { start: coordinate, first: firstSize, second: secondSize, total };
    event.currentTarget.focus();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* jsdom and older browsers may not implement capture */ }
    event.preventDefault();
  };
  const finishPointerResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    dragRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* no captured pointer */ }
  };
  const adjustByKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const positive = vertical ? event.key === 'ArrowRight' : event.key === 'ArrowDown';
    const negative = vertical ? event.key === 'ArrowLeft' : event.key === 'ArrowUp';
    if (!positive && !negative) return;
    event.preventDefault();
    const { firstSize, secondSize, total } = readSizes(event.currentTarget);
    const step = event.shiftKey ? 32 : 8;
    const next = clampTrackSize(first, second, total, firstSize + (positive ? step : -step));
    onResize(splitId, index, next, total - next);
  };

  return (
    <button
      className={`${styles.divider} ${vertical ? styles.dividerVertical : styles.dividerHorizontal}`}
      style={dividerColor ? { background: dividerColor } : undefined}
      type="button"
      role="slider"
      aria-label={`${first.id} ${second.id} resize`}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={initialNow}
      aria-valuemin={initialMin}
      aria-valuemax={initialMax}
      aria-valuetext={`${Math.round(initialNow)}px`}
      tabIndex={0}
      onPointerDown={startPointerResize}
      onPointerMove={applyPointerResize}
      onPointerUp={finishPointerResize}
      onPointerCancel={finishPointerResize}
      onKeyDown={adjustByKeyboard}
    />
  );
}

function MockTerminal({ address }: { address: string }) {
  const terminal = mockHcBridge.terminals().find((item) => item.address === address);
  const seat = seatSpec(terminal?.seat);
  const look = useLook();
  const terminalStyle: CSSProperties = {
    ...(look?.font ? { fontFamily: look.font } : {}),
    ...(look?.font_size !== undefined ? { fontSize: `${look.font_size}px` } : {}),
    ...(look?.terminal_padding !== undefined ? { padding: `${look.terminal_padding}px` } : {}),
    ...(look?.terminal_opacity !== undefined ? { opacity: look.terminal_opacity } : {}),
  };
  return (
    <section className={styles.terminal} style={terminalStyle} role="region" aria-label={`Terminal ${address}`}>
      <header><span>{seat ? `${seat.title} · ` : ''}{terminal?.label ?? 'Terminal fixture missing'}</span><code>{address}</code></header>
      <pre>{terminal?.preview ?? 'No matching terminal in mock fixtures.'}</pre>
      <footer>fixture · {terminal?.state ?? 'unavailable'}</footer>
    </section>
  );
}

function MockTab({ tab }: { tab: string }) {
  const ui = useUi();
  const effective = tab === 'active' ? ui.activeTab : tab;
  const terminals = mockHcBridge.terminals().filter((terminal) => terminal.tab === effective || effective === 'active' && terminal.spaceId === 'local');
  return (
    <section className={styles.tabPane} role="region" aria-label={`Tab ${effective}`}>
      <header><strong>{effective === 'active' ? 'Active tab' : `Tab ${effective}`}</strong><span>{terminals.length} fixture panes</span></header>
      {terminals.length ? terminals.map((terminal) => <MockTerminal key={terminal.address} address={terminal.address} />) : <p>No terminal fixtures in this tab.</p>}
    </section>
  );
}

function MockAgent({ agent }: { agent: string }) {
  const ui = useUi();
  const wanted = agent === 'focused' ? (ui.focusedAgent ?? agent) : agent;
  const row = mockHcBridge.agents().find((item) => wanted === 'focused' || item.id === wanted || item.name === wanted);
  const terminal = row ? mockHcBridge.terminals().find((item) => item.address === row.terminal) : undefined;
  const badge = row ? AGENT_STATUS[row.status] : undefined;
  return (
    <section className={styles.agentPane} role="region" aria-label={`Agent ${agent}`}>
      <header><strong>{row?.name ?? 'No matching agent fixture'}</strong>{badge && <StatusBadge status={badge.status} label={badge.label} />}</header>
      <p>{terminal?.preview ?? 'Agent data is unavailable in the mock fixture.'}</p>
      <code>{terminal?.address ?? agent}</code>
    </section>
  );
}

// --- E2: живой режим (live bridge) ------------------------------------------

export interface LiveData {
  spaces: LiveSpace[];
  terminals: LiveTerminal[];
  agents: LiveAgent[];
  /** причина недоступности моста — честный offline без фейков */
  error: string | null;
}

export const LIVE_POLL_MS = 300;
export const LIVE_SCREEN_COLS = 120;
export const LIVE_SCREEN_ROWS = 24;

/** E2 live-контекст: null = mock-режим (E1). Провайдер ставит bridge+данные. */
export interface LiveCtx { live: LiveData; bridge: NewfBridge; dismissAttention: (address: string) => void }
export const LiveContext = createContext<LiveCtx | null>(null);

/** #552: floating-контекст — detach/close любой панели поверх канваса. */
export interface FloatingCtxValue {
  open: (address: string) => void;
  close: (address: string) => void;
  /** #552b: вынести терминал в отдельное OS-окно (ctl → fallback window.open). */
  popOut?: (address: string) => void;
}
export const FloatingCtx = createContext<FloatingCtxValue | null>(null);

/** E3 UI-состояние workspace: выбранный спейс/вкладка/агент (моды меняют его). */
export interface UiState {
  activeTab: string;
  activeSpace?: string;
  focusedAgent?: string;
  /** Порядок агентов для keyboard-навигации (id; дефолт — порядок данных мода). */
  agentOrder?: string[];
  setActiveTab: (tab: string) => void;
  setActiveSpace: (id?: string) => void;
  setFocusedAgent: (id?: string) => void;
  setAgentOrder: (order: string[]) => void;
  /** Фокус на следующем/предыдущем агенте по agentOrder (fallback: первый/последний). */
  focusNextAgent: () => void;
  focusPrevAgent: () => void;
}
export const UiContext = createContext<UiState | null>(null);

export function useUi(): UiState {
  return useContext(UiContext) ?? {
    activeTab: 'active',
    setActiveTab: () => {},
    setActiveSpace: () => {},
    setFocusedAgent: () => {},
    setAgentOrder: () => {},
    focusNextAgent: () => {},
    focusPrevAgent: () => {},
  };
}

// --- §5 persistence & layout commands --------------------------------------

/**
 * Хранилище кликов .state. В рантайме — localStorage с fallback на память;
 * в тестах — фейковый in-memory store (createInMemoryStateStore).
 */
export interface StateStore {
  load(key: string): string | null;
  /** null удаляет ключ. */
  save(key: string, value: string | null): void;
}

export function createInMemoryStateStore(): StateStore {
  const entries = new Map<string, string>();
  return {
    load: (key) => entries.get(key) ?? null,
    save: (key, value) => {
      if (value === null) entries.delete(key);
      else entries.set(key, value);
    },
  };
}

export function createLocalStorageStateStore(): StateStore {
  const fallback = createInMemoryStateStore();
  let storage: Storage | null = null;
  try {
    if (typeof window !== 'undefined' && typeof window.localStorage !== 'undefined') {
      storage = window.localStorage;
    }
  } catch {
    storage = null;
  }
  if (!storage) return fallback;
  return {
    load: (key) => {
      try { return storage!.getItem(key); } catch { return fallback.load(key); }
    },
    save: (key, value) => {
      try {
        if (value === null) storage!.removeItem(key);
        else storage!.setItem(key, value);
      } catch { fallback.save(key, value); }
    },
  };
}

export function layoutStateKey(layoutId: string): string {
  return `newf/layouts/${layoutId}.state`;
}

/** Исходник layout-файла (для клонов) в хранилище. */
export function layoutSourceKey(layoutId: string): string {
  return `newf/layouts/${layoutId}.source`;
}

/** Индекс доступных layout-ов (клоны) в хранилище. */
export const LAYOUT_INDEX_KEY = 'newf/layouts.index';

export function readLayoutIndex(store: StateStore): string[] {
  const raw = store.load(LAYOUT_INDEX_KEY);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item): item is string => typeof item === 'string')) return parsed;
    return [];
  } catch {
    return [];
  }
}

export function writeLayoutIndex(store: StateStore, ids: string[]): void {
  store.save(LAYOUT_INDEX_KEY, JSON.stringify(ids));
}

function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'layout';
}

/** djb2-hex отпечаток layout-файла — версия «источника» для правила «файл бьёт клик». */
export function fingerprint(source: string): string {
  let hash = 5381;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) + hash + source.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

/** Схема файла .state: версия layout-источника + клики. */
export interface LayoutStateFile {
  version: string;
  agentOrder?: string[];
  activeSpace?: string;
  activeTab?: string;
  focusedAgent?: string;
  sizes?: Record<string, number>;
}

export function serializeLayoutState(state: Omit<LayoutStateFile, 'version'>, version: string): string {
  return JSON.stringify({ version, ...state });
}

export function parseLayoutState(source: string | null): LayoutStateFile | null {
  if (source === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  if (typeof raw.version !== 'string') return null;
  const out: LayoutStateFile = { version: raw.version };
  if (Array.isArray(raw.agentOrder) && raw.agentOrder.every((id): id is string => typeof id === 'string')) {
    out.agentOrder = raw.agentOrder;
  }
  if (typeof raw.activeSpace === 'string') out.activeSpace = raw.activeSpace;
  if (typeof raw.activeTab === 'string') out.activeTab = raw.activeTab;
  if (typeof raw.focusedAgent === 'string') out.focusedAgent = raw.focusedAgent;
  if (isRecord(raw.sizes)) {
    const sizes: Record<string, number> = {};
    for (const [id, px] of Object.entries(raw.sizes)) {
      if (typeof px === 'number' && Number.isFinite(px)) sizes[id] = px;
    }
    if (Object.keys(sizes).length > 0) out.sizes = sizes;
  }
  return out;
}

/** Собрать px-размеры всех узлов дерева (клики ресайза). */
export function collectSizes(node: HerdrLayoutNode): Record<string, number> {
  const sizes: Record<string, number> = {};
  const walk = (current: HerdrLayoutNode) => {
    if (current.size?.px !== undefined) sizes[current.id] = current.size.px;
    current.children?.forEach(walk);
  };
  walk(node);
  return sizes;
}

/** Дельта .state: px-размеры, отличные от файловой версии. */
export function collectSizeDiff(current: HerdrLayoutNode, file: HerdrLayoutNode): Record<string, number> {
  const diff: Record<string, number> = {};
  const walk = (cur: HerdrLayoutNode, f: HerdrLayoutNode) => {
    if (cur.size?.px !== undefined && f.size?.px !== cur.size.px) diff[cur.id] = cur.size.px;
    const fChildren = new Map((f.children ?? []).map((child) => [child.id, child]));
    for (const child of cur.children ?? []) {
      const fChild = fChildren.get(child.id);
      if (fChild) walk(child, fChild);
    }
  };
  walk(current, file);
  return diff;
}

/** Применить сохранённые px-размеры к дереву из файла (только узлы со size.px). */
export function applySizes(node: HerdrLayoutNode, sizes: Record<string, number> | undefined): HerdrLayoutNode {
  if (!sizes) return node;
  const walk = (current: HerdrLayoutNode): HerdrLayoutNode => {
    const children = current.children?.map(walk);
    let next: HerdrLayoutNode = children && children.some((child, index) => child !== current.children?.[index])
      ? { ...current, children }
      : current;
    const px = current.size?.px !== undefined ? sizes[current.id] : undefined;
    if (px !== undefined) {
      const clamped = Math.max(current.min ?? 0, Math.min(current.max ?? px, px));
      next = { ...next, size: { px: clamped } };
    }
    return next;
  };
  return walk(node);
}

function layoutContentToJson(content: HerdrLayoutContent): Record<string, unknown> {
  switch (content.kind) {
    case 'mod': return content.props !== undefined ? { mod: content.name, props: content.props } : { mod: content.name };
    case 'terminal': return { terminal: content.address };
    case 'tab': return content.pane !== undefined ? { tab: content.tab, pane: content.pane } : { tab: content.tab };
    case 'agent': return { agent: content.agent };
  }
}

function layoutNodeToJson(node: HerdrLayoutNode): Record<string, unknown> {
  const out: Record<string, unknown> = { id: node.id, type: node.type };
  if (node.children) out.children = node.children.map(layoutNodeToJson);
  if (node.content) out.content = layoutContentToJson(node.content);
  if (node.active !== undefined) out.active = node.active;
  if (node.size) out.size = { ...node.size };
  if (node.min !== undefined) out.min = node.min;
  if (node.max !== undefined) out.max = node.max;
  if (node.padding !== undefined) out.padding = node.padding;
  if (node.gap !== undefined) out.gap = node.gap;
  if (node.resizable !== undefined) out.resizable = node.resizable;
  if (node.movable !== undefined) out.movable = node.movable;
  if (node.hidden !== undefined) out.hidden = node.hidden;
  if (node.divider) out.divider = { ...node.divider };
  if (node.border) out.border = { ...node.border };
  if (node.radius !== undefined) out.radius = node.radius;
  if (node.shadow) out.shadow = node.shadow;
  if (node.background !== undefined) out.background = node.background;
  if (node.header) out.header = { content: layoutContentToJson(node.header.content) };
  if (node.look) out.look = { ...node.look };
  return out;
}

/** Сериализация текущего дерева в JSON layout-файла (для clone). */
export function serializeLayout(node: HerdrLayoutNode): string {
  return JSON.stringify(layoutNodeToJson(node));
}

export interface LayoutCommands {
  layoutNames: string[];
  activeLayoutId: string;
  switchLayout: (id: string) => void;
  switchNextLayout: () => void;
  resetLayout: () => void;
  cloneLayout: (name: string) => string | null;
}

const LayoutCommandsContext = createContext<LayoutCommands | null>(null);

/** Команды layout (switch/reset/clone) — доступны внутри NewfScreen. */
export function useLayoutCommands(): LayoutCommands {
  const commands = useContext(LayoutCommandsContext);
  if (!commands) throw new Error('useLayoutCommands must be used inside NewfScreen');
  return commands;
}

/** Данные для модов: live-контекст или фикстуры E1 — один ModData-шов. */
export function useModData(): ModData {
  const ctx = useContext(LiveContext);
  if (ctx) {
    return {
      live: true,
      error: ctx.live.error,
      spaces: ctx.live.spaces,
      terminals: ctx.live.terminals,
      agents: ctx.live.agents,
    };
  }
  return {
    live: false,
    error: null,
    spaces: mockHcBridge.spaces(),
    terminals: mockHcBridge.terminals(),
    agents: mockHcBridge.agents(),
  };
}

const LIVE_STATES: LiveTerminal['state'][] = ['working', 'idle', 'blocked', 'done', 'error'];

/** #517: применить SSE-событие статуса к живым данным (между поллами). */
export function applyStatusEvent(prev: LiveData, event: LiveEvent): LiveData {
  if (prev.error) return prev;
  const address = typeof event.address === 'string' ? event.address : undefined;
  if (!address) return prev;
  const state = event.state ?? event.status;
  if (typeof state !== 'string' || !LIVE_STATES.includes(state as LiveTerminal['state'])) return prev;
  let changed = false;
  const terminals = prev.terminals.map((t) => {
    if (t.address !== address) return t;
    // W2: attention-флаг (из события attention)
    const attention = event.type === 'attention' ? true : t.attention;
    if (t.state !== state || t.attention !== attention) {
      changed = true;
      return { ...t, state: state as LiveTerminal['state'], attention };
    }
    return t;
  });
  const agents = prev.agents.map((a) => {
    if (a.terminal === address && a.status !== state) {
      changed = true;
      return { ...a, status: state as LiveAgent['status'] };
    }
    return a;
  });
  return changed ? { ...prev, terminals, agents } : prev;
}

export function useLiveData(bridge: NewfBridge | null): LiveData & { dismissAttention: (address: string) => void } {
  const [data, setData] = useState<LiveData>({ spaces: [], terminals: [], agents: [], error: null });
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissAttention = useCallback((address: string) => {
    setData((prev) => ({
      ...prev,
      terminals: prev.terminals.map((t) => t.address === address ? { ...t, attention: false } : t),
    }));
  }, []);
  useEffect(() => {
    if (!bridge) return;
    let alive = true;
    const load = async () => {
      try {
        const [spaces, terminals, agents] = await Promise.all([
          bridge.spaces(), bridge.terminals(), bridge.agents(),
        ]);
        if (alive) setData({ spaces, terminals, agents, error: null });
      } catch (error) {
        if (alive) setData((prev) => ({
          ...prev,
          error: error instanceof BridgeUnavailable ? error.message : 'bridge error',
        }));
      }
    };
    void load();
    timer.current = setInterval(() => void load(), LIVE_POLL_MS);
    let unsubscribe: (() => void) | undefined;
    // #517: SSE-подписка /events — статусы агентов/терминалов между поллами
    // (OSC 7501: idle/working/done/blocked/error); структурные события →
    // внеочередное перечтение моста (честно, не мок).
    if (bridge.streamEvents) {
      unsubscribe = bridge.streamEvents(
        (event) => {
          if (event.type === 'status' || event.type === 'attention' || event.type === 'done') {
            setData((prev) => applyStatusEvent(prev, event));
          } else if (event.type === 'renamed' && typeof event.new === 'string') {
            // W2: переименование терминала — перечитываем мост, чтобы адрес обновился.
            void load();
          } else if (event.type === 'created' || event.type === 'lost'
            || event.type === 'restarted' || event.type === 'finished' || event.type === 'removed') {
            void load();
          }
        },
        () => { /* обрыв стрима: следующий полл восстановит */ },
        ['attention', 'exited', 'status', 'renamed'],
      );
    }
    return () => { alive = false; if (timer.current) clearInterval(timer.current); unsubscribe?.(); };
  }, [bridge]);
  return { ...data, dismissAttention };
}

export function LiveTerminalPane({ address, bridge }: { address: string; bridge: NewfBridge }) {
  const [error, setError] = useState<string | null>(null);
  const liveCtx = useContext(LiveContext);
  const meta = liveCtx?.live.terminals.find((t) => t.address === address);
  const live = useLiveTerminalScreen(bridge, address, {
    cols: meta?.cols ?? LIVE_SCREEN_COLS,
    rows: meta?.rows ?? LIVE_SCREEN_ROWS,
    pollMs: LIVE_POLL_MS,
  });
  const paneError = live.error ?? error;
  const look = useLook();
  const floatingCtx = useContext(FloatingCtx);
  const terminalStyle: CSSProperties = {
    ...(look?.font ? { fontFamily: look.font } : {}),
    ...(look?.font_size !== undefined ? { fontSize: `${look.font_size}px` } : {}),
    ...(look?.terminal_padding !== undefined ? { padding: `${look.terminal_padding}px` } : {}),
    ...(look?.terminal_opacity !== undefined ? { opacity: look.terminal_opacity } : {}),
  };

  /** #528 Herdr-parity: живой ввод без отдельного input-бокса.
   *  Печатные символы → /send {term, text: char}; спец-клавиши → /keys;
   *  эхо не рисуем — придёт от shell на следующем полле (200ms).
   *  Без блокировок: быстрая печать не должна ждать сетевых запросов
   *  (backend/AEGIS упорядочивают сам). */
  const sendChars = async (text: string) => {
    if (!text) return;
    try {
      await bridge.send(address, text);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'send failed');
    }
  };
  const sendKey = async (key: string) => {
    try {
      await bridge.keys(address, [key]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'keys failed');
    }
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (paneError) return;
    if (e.ctrlKey || e.metaKey || e.altKey) {
      // Ctrl-комбинации: словарь (ctrl+c / ctrl+d / ctrl+z / ctrl+\ и др.),
      // остальное — игнорируем (не шлём мусор в PTY).
      const ctrl: Record<string, string> = {
        c: 'ctrl+c', d: 'ctrl+d', z: 'ctrl+z', '\\': 'ctrl+\\',
      };
      const key = ctrl[e.key.toLowerCase()];
      if (key) {
        e.preventDefault();
        void sendKey(key);
      }
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void sendKey('enter');
      return;
    }
    if (e.key === 'Backspace') {
      e.preventDefault();
      void sendKey('backspace');
      return;
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      void sendKey(e.shiftKey ? 'shift+tab' : 'tab');
      return;
    }
    const special: Record<string, string> = {
      ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
      Escape: 'esc', Delete: 'delete', Insert: 'insert', Home: 'home', End: 'end',
      PageUp: 'pgup', PageDown: 'pagedown', F1: 'f1', F2: 'f2', F3: 'f3',
      F4: 'f4', F5: 'f5', F6: 'f6', F7: 'f7', F8: 'f8', F9: 'f9',
      F10: 'f10', F11: 'f11', F12: 'f12',
    };
    const mapped = special[e.key];
    if (mapped) {
      e.preventDefault();
      void sendKey(mapped);
      return;
    }
    // Печатные символы (single Unicode-глиф)
    if (e.key.length === 1) {
      e.preventDefault();
      void sendChars(e.key);
    }
  };

  const handlePaste = (e: ReactClipboardEvent<HTMLElement>) => {
    const text = e.clipboardData.getData('text');
    if (text) {
      e.preventDefault();
      // #557: paste → POST /api/core/put {term, text} — без Enter.
      if (bridge.put) {
        void bridge.put(address, text).catch((err) => setError(err instanceof Error ? err.message : 'put failed'));
      } else {
        void sendChars(text);
      }
    }
  };

  // W4: фокус/взаимодействие с панелью сбрасывает attention-бейдж.
  const focusDismiss = useCallback(() => {
    liveCtx?.dismissAttention(address);
  }, [liveCtx, address]);

  // W10: send-file — drag&drop файла на терминал (POST send-file, send:true).
  const [dragOver, setDragOver] = useState(false);
  const handleDrop = useCallback(async (e: ReactDragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!bridge.sendFile) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    for (const file of files) {
      try {
        const text = await file.text();
        await bridge.sendFile(address, { content: text, name: file.name, send: true });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'send-file failed');
      }
    }
  }, [address, bridge]);

  const badge = meta ? OSC_BADGE[meta.state] : undefined;
  const seat = seatSpec(meta?.seat);
  return (
    <section
      className={styles.terminal}
      style={terminalStyle}
      role="region"
      aria-label={`Terminal ${address}`}
      data-state={paneError ? 'unavailable' : 'live'}
      tabIndex={paneError ? -1 : 0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onFocus={focusDismiss}
      onPointerDown={focusDismiss}
      onDragOver={(e) => { if (bridge.sendFile) { e.preventDefault(); setDragOver(true); } }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      data-terminal-input="live"
      data-drag-over={dragOver ? 'true' : undefined}
    >
      <header>
        <span>{seat ? `${seat.title} · ` : ''}{meta?.label || address}</span>
        <span className={styles.termMeta}>{badge && <StatusBadge status={badge.status} label={meta!.state} />}{live.offline ? <StatusBadge status="warning" label="stale" /> : null}<code>{address}</code>
          {floatingCtx && (
            <>
              <button
                type="button"
                className={styles.floatingBtn}
                data-testid={`detach-${address}`}
                onClick={() => floatingCtx.open(address)}
                aria-label="Detach panel"
                title="Отцепить панель"
              >⧉</button>
              {floatingCtx.popOut && (
                <button
                  type="button"
                  className={styles.floatingBtn}
                  data-testid={`popout-${address}`}
                  onClick={() => floatingCtx.popOut?.(address)}
                  aria-label="Вынести в окно"
                  title="OS-level pop-out"
                >⤢</button>
              )}
              {bridge.dumpUrl && (
                <a
                  className={styles.floatingBtn}
                  href={bridge.dumpUrl(address)}
                  download
                  data-testid={`dump-${address}`}
                  title="Download transcript"
                >⬇</a>
              )}
            </>
          )}
        </span>
      </header>
      <NewfGpuScreenLazy
        screen={paneError ? `bridge: ${paneError}` : (live.screen || '…')}
        testId={`term-screen-live-${address}`}
      />
      <footer>
        <span className={styles.termHint}>{paneError ? 'unavailable' : 'клик → ввод (Enter/стрелки/Ctrl+C)'}</span>
        <span>{live.offline ? 'stale' : paneError ? 'unavailable' : `live · ${LIVE_POLL_MS}ms`}</span>
      </footer>
    </section>
  );
}

function MockMod({ name }: { name: string }) {
  return <SharedMod name={name} />;
}

/** Единый мод-диспетчер: данные по режиму, UI-состояние общее. */
function SharedMod({ name }: { name: string }) {
  const data = useModData();
  const ui = useUi();
  const liveCtx = useContext(LiveContext);
  const run = liveCtx?.bridge.run;
  return (
    <NewfModLazy
      name={name}
      data={data}
      run={run}
      bridge={liveCtx?.bridge ?? null}
      activeTab={ui.activeTab}
      activeSpace={ui.activeSpace}
      focusedAgent={ui.focusedAgent}
      onSelectTab={ui.setActiveTab}
      onSelectSpace={ui.setActiveSpace}
      onSelectAgent={ui.setFocusedAgent}
      onFocusNextAgent={ui.focusNextAgent}
      onFocusPrevAgent={ui.focusPrevAgent}
      onSetAgentOrder={ui.setAgentOrder}
    />
  );
}

function LiveMod({ name }: { name: string }) {
  return <SharedMod name={name} />;
}

/**
 * #517: живой список терминалов (backend=core). При terminals=[] — честный
 * empty-state «no terminals: nx run» (не падает, не мокает). При bridge offline
 * — текст ошибки, тоже без фиктивных данных.
 */
export function NewfTerminals({ address }: { address?: string }) {
  const ctx = useContext(LiveContext)!;
  const { terminals, error } = ctx.live;
  const list = address
    ? terminals.filter((t) => t.address === address || t.agent === address)
    : terminals;
  if (error) {
    return (
      <section className={styles.agentPane} role="region" aria-label="Terminals" data-state="unavailable">
        <header><strong>Terminals</strong></header>
        <p>bridge: {error}</p>
      </section>
    );
  }
  return (
    <section className={styles.agentPane} role="region" aria-label="Terminals" data-state={terminals.length ? 'ready' : 'empty'}>
      <header><strong>Terminals</strong><span>{terminals.length} live</span></header>
      {list.length === 0 ? (
        <p data-testid="terminals-empty">no terminals: nx run</p>
      ) : (
        <ul>
          {list.map((t) => (
            <li key={t.address}>
              <LiveTerminalPane address={t.address} bridge={ctx.bridge} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LiveTab({ tab }: { tab: string }) {
  const ctx = useContext(LiveContext)!;
  const ui = useUi();
  const effective = tab === 'active' ? ui.activeTab : tab;
  const terminals = ctx.live.terminals.filter((t) => t.tab === effective || (effective === 'active' && !t.tab));
  return (
    <section className={styles.tabPane} role="region" aria-label={`Tab ${effective}`}>
      <header><strong>{effective === 'active' ? 'Active tab' : `Tab ${effective}`}</strong><span>{ctx.live.error ? 'bridge offline' : `${terminals.length} live`}</span></header>
      {ctx.live.error ? <p>bridge: {ctx.live.error}</p>
        : terminals.length ? terminals.map((t) => <LiveTerminalPane key={t.address} address={t.address} bridge={ctx.bridge} />)
        : <p data-testid="terminals-empty">Нет живых терминалов в этой вкладке. no terminals: nx run</p>}
    </section>
  );
}

function LiveAgentPane({ agent }: { agent: string }) {
  const ctx = useContext(LiveContext)!;
  const ui = useUi();
  const wanted = agent === 'focused' ? (ui.focusedAgent ?? agent) : agent;
  const row = ctx.live.agents.find((a) => wanted === 'focused' || a.id === wanted || a.name === wanted);
  const badge = row && row.status !== 'archived'
    ? (AGENT_STATUS[row.status === 'error' ? 'blocked'
        : row.status === 'exited' ? 'done'
        : row.status] ?? AGENT_STATUS.idle)
    : undefined;
  return (
    <section className={styles.agentPane} role="region" aria-label={`Agent ${agent}`}>
      <header><strong>{row?.name ?? 'нет живого агента'}</strong>{badge && <StatusBadge status={badge.status} label={row!.status} />}</header>
      {row ? <LiveTerminalPane address={row.terminal} bridge={ctx.bridge} /> : <p>{ctx.live.error ?? 'Агент не найден в live-ростере.'}</p>}
    </section>
  );
}

function LayoutContent({ content }: { content: HerdrLayoutContent }): ReactNode {
  const ctx = useContext(LiveContext);
  if (ctx) {
    if (content.kind === 'mod') return <LiveMod name={content.name} />;
    if (content.kind === 'terminal') return <LiveTerminalPane address={content.address} bridge={ctx.bridge} />;
    if (content.kind === 'tab') return <LiveTab tab={content.tab} />;
    return <LiveAgentPane agent={content.agent} />;
  }
  if (content.kind === 'mod') return <MockMod name={content.name} />;
  if (content.kind === 'terminal') return <MockTerminal address={content.address} />;
  if (content.kind === 'tab') return <MockTab tab={content.tab} />;
  return <MockAgent agent={content.agent} />;
}

/** #528 Herdr-parity: плавающее терминал-окно (перетаскиваемое, keep/×). */
export interface FloatingWindow {
  x: number;
  y: number;
  w: number;
  h: number;
  /** keep=pin: не закрывать при фокусе другого агента. */
  pinned: boolean;
}

export function FloatingTerminal({ address, win, onDrag, onClose, onTogglePin, onDockBack }: {
  address: string;
  win: FloatingWindow;
  onDrag: (x: number, y: number) => void;
  onClose: () => void;
  onTogglePin: () => void;
  /** #528 полный docking: вернуть панель в слот (по умолчанию = закрыть). */
  onDockBack?: () => void;
}) {
  const { zIndex, raise } = useZIndex();
  const drag = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const ctx = useContext(LiveContext);
  if (!ctx) return null;
  const label = ctx.live.terminals.find((t) => t.address === address)?.label ?? address;

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    drag.current = { startX: event.clientX, startY: event.clientY, origX: win.x, origY: win.y };
    const onMove = (move: PointerEvent) => {
      if (!drag.current) return;
      onDrag(drag.current.origX + (move.clientX - drag.current.startX), drag.current.origY + (move.clientY - drag.current.startY));
    };
    const onUp = () => {
      drag.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <section
      className={styles.floatingTerminal}
      role="region"
      aria-label={`Floating terminal ${address}`}
      data-testid="floating-terminal"
      data-floating-address={address}
      data-floating-pinned={win.pinned ? 'true' : undefined}
      style={{ left: win.x, top: win.y, width: win.w, height: win.h, zIndex }}
      onPointerDownCapture={raise}
    >
      <header className={styles.floatingHeader} onPointerDown={onPointerDown}>
        <strong>{label}</strong>
        <button type="button" className={styles.floatingBtn} data-testid={`floating-dock-${address}`} onClick={onDockBack ?? onClose} aria-label="Dock back">⟲</button>
        <button type="button" className={styles.floatingBtn} data-testid={`floating-keep-${address}`} onClick={onTogglePin} aria-pressed={win.pinned}>
          {win.pinned ? 'keep ✓' : 'keep'}
        </button>
        <button type="button" className={styles.floatingBtn} data-testid={`floating-close-${address}`} onClick={onClose} aria-label="Close floating terminal">×</button>
      </header>
      <LiveTerminalPane address={address} bridge={ctx.bridge} />
    </section>
  );
}

/**
 * #552b: OS-level pop-out — отдельное окно с одним терминалом (?pop=<addr>).
 * Страница рендерит ТОЛЬКО панель терминала (без sidebar/других панелей),
 * с заголовком и кнопкой ⟲ (re-dock): шлёт 'dock:<addr>' в BroadcastChannel
 * 'newf-dock' + закрывает OS-окно через ctl (fallback window.close).
 */
export function NewfPopScreen({ live, bridgeBase, backend, address }: {
  live: boolean;
  bridgeBase?: string;
  backend?: string;
  address: string;
}) {
  const bridge = useMemo(() => {
    if (!live) return null;
    return createCoreBridge(bridgeBase);
  }, [live, bridgeBase, backend]);

  const [docked, setDocked] = useState(false);

  const dockBack = useCallback(() => {
    if (docked) return;
    setDocked(true);
    try {
      new BroadcastChannel('newf-dock').postMessage(`dock:${address}`);
    } catch { /* no BroadcastChannel */ }
    const port = window.location.port;
    if (port) {
      void fetch(`${window.location.origin}/__newfctl__`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'close', win: `pop-${address}` }),
      }).catch(() => { try { window.close(); } catch { /* no window.close */ } });
    } else {
      try { window.close(); } catch { /* no window.close */ }
    }
  }, [address, docked]);

  if (!live || !bridge) {
    return (
      <div className={styles.popShell}>
        <header className={styles.popHeader}><span>NEWF · {address}</span></header>
        <div className={styles.popBody}><p>live required (?live=1&backend=core&pop={address})</p></div>
      </div>
    );
  }
  return (
    <div className={styles.popShell} data-screen="newf-pop" data-testid="newf-pop">
      <header className={styles.popHeader}>
        <span>NEWF · {address}</span>
        <span className={styles.termMeta}>
          {bridge.dumpUrl && (
            <a className={styles.floatingBtn} href={bridge.dumpUrl(address)} download data-testid={`pop-dump-${address}`} title="Download transcript">⬇</a>
          )}
          <button type="button" className={styles.floatingBtn} onClick={dockBack} data-testid="pop-dock-back" aria-label="Re-dock">
            ⟲ re-dock
          </button>
        </span>
      </header>
      <div className={styles.popBody}>
        <LiveTerminalPane address={address} bridge={bridge} />
      </div>
    </div>
  );
}

/** Панель команд layout — switch/reset/clone через LayoutCommandsContext. */
function LayoutToolbar() {
  const commands = useLayoutCommands();
  const voiceUi = useVoiceUi();
  const [cloneName, setCloneName] = useState('');
  const [pendingSwitch, setPendingSwitch] = useState<string | null>(null);
  const clone = () => {
    const name = cloneName.trim() || `${commands.activeLayoutId}-copy`;
    const id = commands.cloneLayout(name);
    if (id) {
      setCloneName('');
      setPendingSwitch(id);
    }
  };
  // Клон создаётся в состоянии layoutRegistry; переключаемся только когда он там появился.
  useEffect(() => {
    if (pendingSwitch && commands.layoutNames.includes(pendingSwitch)) {
      commands.switchLayout(pendingSwitch);
      setPendingSwitch(null);
    }
  }, [pendingSwitch, commands, commands.layoutNames]);
  return (
    <div className={styles.layoutBar} role="group" aria-label="Layout commands">
      <label>
        <span>Layout</span>
        <select
          value={commands.activeLayoutId}
          onChange={(e) => commands.switchLayout(e.target.value)}
          aria-label="Active layout"
          data-testid="newf-layout-select"
        >
          {commands.layoutNames.map((id) => <option key={id} value={id}>{id}</option>)}
        </select>
      </label>
      <button type="button" onClick={commands.switchNextLayout} data-testid="newf-layout-next">
        Next
      </button>
      <button type="button" onClick={commands.resetLayout} data-testid="newf-layout-reset">
        Reset
      </button>
      <label className={styles.cloneForm}>
        <input
          value={cloneName}
          onChange={(e) => setCloneName(e.target.value)}
          placeholder="new layout name"
          aria-label="New layout name"
          data-testid="newf-layout-clone-name"
        />
        <button type="button" onClick={clone} data-testid="newf-layout-clone">Clone</button>
      </label>
      {voiceUi.active && (
        <button
          type="button"
          className={voiceUi.open ? styles.voiceOn : undefined}
          onClick={() => voiceUi.setOpen(!voiceUi.open)}
          aria-expanded={voiceUi.open}
          aria-label="Голосовая панель"
          data-testid="newf-voice-toggle"
        >
          🎙 Voice
        </button>
      )}
    </div>
  );
}

export function NewfScreen({ layoutJson = DEFAULT_LAYOUT_JSON, live = false, bridgeBase, backend, store = createLocalStorageStateStore(), commandsRef }: {
  layoutJson?: string;
  live?: boolean;
  bridgeBase?: string;
  backend?: 'core' | string;
  store?: StateStore;
  commandsRef?: MutableRefObject<LayoutCommands | null>;
}) {
  const bridge = useMemo(() => {
    if (!live) return null;
    return createCoreBridge(bridgeBase);
  }, [live, bridgeBase, backend]);
  const liveData = useLiveData(bridge);

  // --- §5: реестр layout-файлов + .state кликов ---------------------------
  const [layoutRegistry, setLayoutRegistry] = useState<Record<string, string>>(() => ({ default: layoutJson }));
  const [activeLayoutId, setActiveLayoutId] = useState('default');
  const [layoutState, setLayoutState] = useState<LayoutStateFile | null>(() => parseLayoutState(store.load(layoutStateKey('default'))));

  // Персистентность UI-части UiState: восстанавливается всегда (это не геометрия файла).
  const [activeTab, setActiveTab] = useState(layoutState?.activeTab ?? 'active');
  const [activeSpace, setActiveSpace] = useState<string | undefined>(layoutState?.activeSpace);
  const [focusedAgent, setFocusedAgent] = useState<string | undefined>(layoutState?.focusedAgent);
  const [agentOrder, setAgentOrder] = useState<string[] | undefined>(layoutState?.agentOrder);
  const moveFocus = useCallback((delta: 1 | -1) => {
    setFocusedAgent((current) => {
      if (!agentOrder?.length) return current;
      if (current === undefined) return delta === 1 ? agentOrder[0] : agentOrder[agentOrder.length - 1];
      const index = agentOrder.indexOf(current);
      if (index < 0) return delta === 1 ? agentOrder[0] : agentOrder[agentOrder.length - 1];
      const next = (index + delta + agentOrder.length) % agentOrder.length;
      return agentOrder[next];
    });
  }, [agentOrder]);
  const focusNextAgent = useCallback(() => moveFocus(1), [moveFocus]);
  const focusPrevAgent = useCallback(() => moveFocus(-1), [moveFocus]);
  const ui = useMemo<UiState>(() => ({
    activeTab, setActiveTab, activeSpace, setActiveSpace, focusedAgent, setFocusedAgent,
    agentOrder, setAgentOrder, focusNextAgent, focusPrevAgent,
  }), [activeTab, activeSpace, focusedAgent, agentOrder, focusNextAgent, focusPrevAgent]);

  // --- #528 Herdr-parity: плавающие терминал-окна поверх канваса -------------
  // Клик по агенту (sidebar) открывает отдельное окно; keep=pin не даёт
  // закрыть его при фокусе другого агента; close=× убирает окно;
  // ⟲ (dock back) возвращает панель в слот. Позиции/размеры персистятся.
  const FLOATING_STORAGE_KEY = 'newf/floating';
  const [floating, setFloating] = useState<Record<string, FloatingWindow>>(() => {
    try {
      const raw = window.localStorage.getItem(FLOATING_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, FloatingWindow>;
    } catch { /* ignore */ }
    return {};
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(FLOATING_STORAGE_KEY, JSON.stringify(floating));
    } catch { /* ignore */ }
  }, [FLOATING_STORAGE_KEY, floating]);
  const openFloating = useCallback((address: string) => {
    setFloating((prev) => {
      const next: Record<string, FloatingWindow> = {};
      for (const [addr, win] of Object.entries(prev)) {
        if (win.pinned) next[addr] = win;
      }
      next[address] = prev[address] ?? { x: 140, y: 90, w: 720, h: 380, pinned: false };
      return next;
    });
  }, []);
  const closeFloating = useCallback((address: string) => {
    setFloating((prev) => {
      const next = { ...prev };
      delete next[address];
      return next;
    });
  }, []);
  const togglePinFloating = useCallback((address: string) => {
    setFloating((prev) => {
      const win = prev[address];
      if (!win) return prev;
      return { ...prev, [address]: { ...win, pinned: !win.pinned } };
    });
  }, []);
  const moveFloating = useCallback((address: string, rect: { x: number; y: number }) => {
    setFloating((prev) => {
      const win = prev[address];
      if (!win) return prev;
      return { ...prev, [address]: { ...win, x: Math.max(0, rect.x), y: Math.max(0, rect.y) } };
    });
  }, []);
  // --- #552: detach любой панели через FloatingPane (HERETIC) ----------------
  // «Отцепить» = перенести терминал в плавающее окно FloatingPane; dock back
  // возвращает на место (убирает из detached). Позиции/размеры персистятся.
  const DETACHED_STORAGE_KEY = 'newf/floating-detached';
  const [detached, setDetached] = useState<Record<string, FloatRect>>(() => {
    try {
      const raw = window.localStorage.getItem(DETACHED_STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Record<string, FloatRect>;
    } catch { /* ignore */ }
    return {};
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(DETACHED_STORAGE_KEY, JSON.stringify(detached));
    } catch { /* ignore */ }
  }, [DETACHED_STORAGE_KEY, detached]);
  const detach = useCallback((address: string) => {
    setDetached((prev) => ({ ...prev, [address]: prev[address] ?? DEFAULT_RECT }));
  }, []);
  const dockBack = useCallback((address: string, rect: FloatRect) => {
    setDetached((prev) => {
      const next = { ...prev };
      delete next[address];
      return next;
    });
    // сохраняем rect для следующего detach
    setDetached((prev) => ({ ...prev, [address]: rect }));
  }, []);
  const closeDetached = useCallback((address: string) => {
    setDetached((prev) => {
      const next = { ...prev };
      delete next[address];
      return next;
    });
  }, []);
  // --- #552b: OS-level pop-out ----------------------------------------------
  // Кнопка «вынести в окно»: ctl open (шелл) → fallback window.open.
  // BroadcastChannel 'newf-dock': pop-окно шлёт 'dock:<addr>' → возвращаем
  // панель в слот (открываем floating).
  const popOut = useCallback((address: string) => {
    const path = `/newf.html?live=1&backend=core&pop=${encodeURIComponent(address)}`;
    const port = window.location.port;
    if (port) {
      void fetch(`${window.location.origin}/__newfctl__`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'open', key: `pop-${address}`, path, title: `NEWF · ${address}`, w: 980, h: 640 }),
      }).catch(() => window.open(path, '_blank', 'width=980,height=640'));
    } else {
      window.open(path, '_blank', 'width=980,height=640');
    }
    // Помечаем «вынесена» (badge) — окно остаётся, панель не дублируется.
    setDetached((prev) => ({ ...prev, [address]: prev[address] ?? DEFAULT_RECT }));
  }, []);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel('newf-dock');
    const onMessage = (event: MessageEvent) => {
      const data = typeof event.data === 'string' ? event.data : '';
      if (data.startsWith('dock:')) {
        const addr = data.slice(5);
        if (addr) {
          setDetached((prev) => {
            const next = { ...prev };
            delete next[addr];
            return next;
          });
          openFloating(addr);
        }
      }
    };
    channel.addEventListener('message', onMessage);
    return () => channel.close();
  }, [openFloating]);
  // Автооткрытие floating при выборе агента: один раз на агента.
  const lastOpenedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!live || !focusedAgent) return;
    if (lastOpenedRef.current === focusedAgent) return;
    const row = liveData.agents.find((a) => a.id === focusedAgent || a.name === focusedAgent);
    if (row) {
      lastOpenedRef.current = focusedAgent;
      openFloating(row.terminal);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedAgent, live]);
  const parsedLayout = useMemo(() => {
    try {
      return { layout: parseHerdrLayout(layoutJson), error: null as string | null };
    } catch (error) {
      return { layout: null, error: error instanceof Error ? error.message : 'Unknown layout parse error' };
    }
  }, [layoutJson]);
  const [layout, setLayout] = useState<HerdrLayoutNode | null>(() => {
    if (!parsedLayout.layout) return null;
    const match = layoutState && layoutState.version === fingerprint(layoutJson);
    return match ? applySizes(parsedLayout.layout, layoutState.sizes) : parsedLayout.layout;
  });
  const dragSource = useRef<PaneDragSource | null>(null);
  // Реакция на внешнюю правку layout-файла (prop layoutJson): «файл бьёт клик».
  useEffect(() => {
    setLayoutRegistry((prev) => prev.default === layoutJson ? prev : { ...prev, default: layoutJson });
    if (activeLayoutId !== 'default') return;
    if (!parsedLayout.layout) return;
    const saved = parseLayoutState(store.load(layoutStateKey('default')));
    const match = saved && saved.version === fingerprint(layoutJson);
    setLayout(match ? applySizes(parsedLayout.layout, saved.sizes) : parsedLayout.layout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutJson, parsedLayout]);
  const [focusedNode, setFocusedNode] = useState<string | undefined>(undefined);
  const layoutFocus = useMemo(() => ({ focusedNode, setFocusedNode }), [focusedNode]);
  // W21: справка по шорткатам.
  const [helpOpen, setHelpOpen] = useState(false);

  // --- §5: переключение/сброс/клон + персистентность кликов -----------------
  const persistCurrentState = useCallback(() => {
    if (!layout) return;
    const source = layoutRegistry[activeLayoutId];
    if (source === undefined) return;
    let fileLayout: HerdrLayoutNode | null = null;
    try { fileLayout = parseHerdrLayout(source); } catch { fileLayout = null; }
    const state: LayoutStateFile = {
      version: fingerprint(source),
      agentOrder: agentOrder?.length ? agentOrder : undefined,
      activeSpace,
      activeTab,
      focusedAgent,
      sizes: fileLayout && Object.keys(collectSizeDiff(layout, fileLayout)).length > 0
        ? collectSizeDiff(layout, fileLayout)
        : undefined,
    };
    store.save(layoutStateKey(activeLayoutId), serializeLayoutState(state, state.version));
  }, [layout, layoutRegistry, activeLayoutId, agentOrder, activeSpace, activeTab, focusedAgent, store]);
  // Автосохранение кликов: любые изменения layout/UI уходят в .state активного layout.
  useEffect(() => {
    persistCurrentState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistCurrentState]);
  const applyLayoutFromSource = useCallback((layoutId: string): LayoutStateFile | null => {
    const source = layoutRegistry[layoutId];
    if (source === undefined) return null;
    try {
      const parsed = parseHerdrLayout(source);
      const saved = parseLayoutState(store.load(layoutStateKey(layoutId)));
      const match = saved && saved.version === fingerprint(source);
      // «Осознанная правка файла бьёт клик»: при мисматче версий размеры из файла.
      setLayout(applySizes(parsed, match ? saved.sizes : undefined));
      return match ? saved : null;
    } catch {
      return null;
    }
  }, [layoutRegistry, store]);
  const restoreUiFromState = useCallback((state: LayoutStateFile | null) => {
    setActiveTab(state?.activeTab ?? 'active');
    setActiveSpace(state?.activeSpace);
    setFocusedAgent(state?.focusedAgent);
    setAgentOrder(state?.agentOrder);
  }, []);
  const switchLayout = useCallback((layoutId: string) => {
    if (layoutId === activeLayoutId) return;
    if (layoutRegistry[layoutId] === undefined) return;
    persistCurrentState();
    const saved = applyLayoutFromSource(layoutId);
    setLayoutState(saved);
    restoreUiFromState(saved);
    setActiveLayoutId(layoutId);
  }, [activeLayoutId, layoutRegistry, persistCurrentState, applyLayoutFromSource, restoreUiFromState]);
  const switchNextLayout = useCallback(() => {
    const ids = Object.keys(layoutRegistry);
    if (ids.length === 0) return;
    const index = ids.indexOf(activeLayoutId);
    switchLayout(ids[(index + 1) % ids.length] ?? 'default');
  }, [activeLayoutId, layoutRegistry, switchLayout]);
  const resetLayout = useCallback(() => {
    const source = layoutRegistry[activeLayoutId];
    if (source === undefined) return;
    try {
      const parsed = parseHerdrLayout(source);
      setLayout(parsed);
      setLayoutState(null);
      setActiveTab('active');
      setActiveSpace(undefined);
      setFocusedAgent(undefined);
      setAgentOrder(undefined);
      // Сброс кликов: .state переписывается чистым файловым состоянием (autosave).
      store.save(layoutStateKey(activeLayoutId), serializeLayoutState({}, fingerprint(source)));
    } catch {
      /* невалидный source — layout не трогаем */
    }
  }, [layoutRegistry, activeLayoutId, store]);
  const cloneLayout = useCallback((name: string): string | null => {
    const base = slugify(name);
    let id = base;
    let suffix = 2;
    while (layoutRegistry[id] !== undefined) id = `${base}-${suffix++}`;
    if (!layout) return null;
    const source = serializeLayout(layout);
    setLayoutRegistry((prev) => ({ ...prev, [id]: source }));
    writeLayoutIndex(store, [...Object.keys(layoutRegistry).filter((key) => key !== 'default'), id].sort());
    return id;
  }, [layout, layoutRegistry, store]);
  const commands: LayoutCommands = {
    layoutNames: Object.keys(layoutRegistry),
    activeLayoutId,
    switchLayout,
    switchNextLayout,
    resetLayout,
    cloneLayout,
  };
  useEffect(() => {
    if (commandsRef) commandsRef.current = commands;
  }, [commands, commandsRef]);
  const handleHotkey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    // W21: '?' — справка по шорткатам.
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      setHelpOpen((v) => !v);
      return;
    }
    if (event.key === 'Escape' && helpOpen) {
      event.preventDefault();
      setHelpOpen(false);
      return;
    }
    if (event.key.toLowerCase() !== 'l' || !event.ctrlKey || !event.shiftKey) return;
    event.preventDefault();
    switchNextLayout();
  };
  const editor: LayoutEditorContextValue = {
    dragSource,
    setStackActive: (stackId, childId) => setLayout((current) => current
      ? updateLayoutNode(current, stackId, (stack) => stack.type === 'stack' ? { ...stack, active: childId } : stack)
      : current),
    resize: (splitId, index, firstPx, secondPx) => setLayout((current) => current
      ? updateLayoutNode(current, splitId, (split) => {
        if ((split.type !== 'row' && split.type !== 'column') || !split.children?.[index + 1]) return split;
        const children = [...split.children];
        children[index] = { ...children[index], size: { px: Math.round(firstPx) } };
        children[index + 1] = { ...children[index + 1], size: { px: Math.round(secondPx) } };
        return { ...split, children };
      })
      : current),
    movePane: (splitId, sourceId, targetId, edge) => setLayout((current) => current
      ? movePaneInLayout(current, splitId, sourceId, targetId, edge)
      : current),
  };
  const parseError = parsedLayout.error;

  const backendName = backend === 'core' ? 'nexus-core' : 'live-bridge';
  const modeLabel = live
    ? liveData.error ? `${backendName} · offline` : `${backendName} · live · ${liveData.terminals.length} terms`
    : 'Mock bridge · offline';
  const modeStatus: NexusStatus = live && !liveData.error ? 'active' : 'offline';

  return (
    <LayoutCommandsContext.Provider value={commands}>
      <div className={styles.page} data-screen="newf" data-mode={live ? 'live' : 'mock'} data-testid="newf-workspace" data-layout-active={activeLayoutId} onKeyDown={handleHotkey}>
        <PanelHeader
          level="screen"
          title="NEWF"
          subtitle={live ? `Layout renderer · E2 live ${backendName}` : 'Layout renderer · interactive mock'}
          actions={<StatusBadge status={modeStatus} label={modeLabel} />}
        />
        <LayoutToolbar />
        <GlassPanel className={styles.notice} data-state={liveData.error ? 'unavailable' : undefined}>
          {live
            ? liveData.error
              ? `${backendName} недоступен: ${liveData.error}. Данные не подставляются — честный offline (без моков).`
              : `E2 live-режим: терминалы и агенты — реальный ${backendName}; экран обновляется каждые 2.5s.`
            : 'Mock layout editor: resize splits, switch stack tabs, and move panes. No terminal or agent commands are sent.'}
        </GlassPanel>
        {parseError ? (
          <GlassPanel className={styles.error} role="alert" data-state="error">
            Invalid layout JSON: {parseError}
          </GlassPanel>
        ) : layout && !(live && liveData.error) ? (
          <GlassPanel className={styles.frame} role="region" data-state={live ? 'live' : 'mock'} aria-label="Rendered layout">
            <UiContext.Provider value={ui}>
              <LiveContext.Provider value={live && bridge ? { live: liveData, bridge, dismissAttention: liveData.dismissAttention } : null}>
                <FloatingCtx.Provider value={{ open: openFloating, close: closeFloating, popOut }}>
                  <LayoutEditorContext.Provider value={editor}>
                    <LayoutFocusContext.Provider value={layoutFocus}>
                      <LayoutNodeView node={layout} />
                      {Object.entries(floating).map(([address, win]) => (
                        <FloatingTerminal
                          key={address}
                          address={address}
                          win={win}
                          onDrag={(x, y) => moveFloating(address, { x, y })}
                          onClose={() => closeFloating(address)}
                          onTogglePin={() => togglePinFloating(address)}
                        />
                      ))}
                      {Object.entries(detached).map(([address, rect]) => (
                        <FloatingPane
                          key={address}
                          address={address}
                          title={liveData.terminals.find((t) => t.address === address)?.label ?? address}
                          initialRect={rect}
                          onDockBack={(addr, r) => dockBack(addr, r)}
                          onClose={(addr) => closeDetached(addr)}
                          slotRect={{ x: 40, y: 40, w: Math.max(320, window.innerWidth - 80), h: Math.max(200, window.innerHeight - 80) }}
                        >
                          <LiveTerminalPane address={address} bridge={bridge!} />
                        </FloatingPane>
                      ))}
                    </LayoutFocusContext.Provider>
                  </LayoutEditorContext.Provider>
                </FloatingCtx.Provider>
              </LiveContext.Provider>
            </UiContext.Provider>
          </GlassPanel>
        ) : null}
        <p className={styles.footerNote}>
          {live ? `Источник: ${backendName} · /api/core (${bridgeBase ?? 'same-origin'}).` : 'Live bridge — передайте prop live (или bridgeBase).'}
        </p>
        <ShortcutHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      </div>
    </LayoutCommandsContext.Provider>
  );
}
