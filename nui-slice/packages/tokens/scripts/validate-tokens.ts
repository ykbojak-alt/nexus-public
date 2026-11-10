/**
 * DTCG token validation (Task 2). Pure functions — no fs access — so the same
 * validator guards the build script and unit tests.
 */

export const KNOWN_TYPES = new Set([
  'color', 'dimension', 'fontFamily', 'fontWeight', 'typography',
  'shadow', 'duration', 'cubicBezier', 'number',
]);

const COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$|^rgba?\(|^var\(|^color-mix\(|^\{[^}]+\}$/;
const DIMENSION_RE = /^-?\d+(?:\.\d+)?(?:px|rem|em|%|ms|s)$|^0$|^\{[^}]+\}$/;

export interface FlatToken {
  path: string;
  type: string;
  value: unknown;
}

/** Flatten a DTCG tree ({$type, $value} leaves) into dotted-path entries. */
export function flattenTokens(node: Record<string, unknown>, prefix = '', out: FlatToken[] = []): FlatToken[] {
  for (const [key, val] of Object.entries(node)) {
    if (key.startsWith('$')) continue;
    if (val === null || typeof val !== 'object') {
      throw new Error(`invalid token entry at "${prefix}${key}": expected object`);
    }
    const rec = val as Record<string, unknown>;
    const path = prefix ? `${prefix}.${key}` : key;
    if ('$value' in rec) {
      const type = (rec.$type as string) ?? inheritedType(node);
      if (!type) throw new Error(`missing $type at "${path}"`);
      out.push({ path, type, value: rec.$value });
    } else {
      flattenTokens(rec, path, out);
    }
  }
  return out;
}

function inheritedType(node: Record<string, unknown>): string | undefined {
  return typeof node.$type === 'string' ? node.$type : undefined;
}

function checkValue(t: FlatToken): void {
  if (t.type === 'color' && typeof t.value === 'string' && !COLOR_RE.test(t.value)) {
    throw new Error(`invalid color at "${t.path}": ${t.value}`);
  }
  if (t.type === 'dimension' && typeof t.value === 'string' && !DIMENSION_RE.test(t.value)) {
    throw new Error(`invalid dimension at "${t.path}": ${t.value}`);
  }
}

/** Collect '{a.b.c}' references from a token value (objects scanned deeply). */
export function tokenRefs(value: unknown): string[] {
  if (typeof value === 'string') return [...value.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  if (Array.isArray(value)) return value.flatMap(tokenRefs);
  if (value && typeof value === 'object') return Object.values(value).flatMap(tokenRefs);
  return [];
}

/**
 * Validate one or more merged DTCG sources.
 * Throws on unknown $type, malformed values, unresolved/cyclic references.
 * Returns the flattened token list for reuse by the emitter.
 */
export function validateTokenSet(sources: Record<string, unknown> | Record<string, unknown>[]): FlatToken[] {
  const list = Array.isArray(sources) ? sources : [sources];
  const flat = list.flatMap((s) => flattenTokens(s));
  const byPath = new Map<string, FlatToken>();
  for (const t of flat) {
    if (!KNOWN_TYPES.has(t.type)) throw new Error(`unknown $type "${t.type}" at "${t.path}"`);
    if (byPath.has(t.path)) throw new Error(`duplicate token path "${t.path}"`);
    byPath.set(t.path, t);
    checkValue(t);
  }
  for (const t of flat) {
    for (const ref of tokenRefs(t.value)) {
      if (!byPath.has(ref)) {
        throw new Error(`unresolved token reference "${ref}" at "${t.path}"`);
      }
    }
  }
  return flat;
}

/** Resolve '{ref}' strings/embedded refs to literal values. Throws on cycles. */
export function resolveReferences(flat: FlatToken[]): Map<string, unknown> {
  const byPath = new Map(flat.map((t) => [t.path, t]));
  const resolved = new Map<string, unknown>();
  const visiting = new Set<string>();

  function resolveValue(v: unknown): unknown {
    if (typeof v === 'string' && /^\{[^}]+\}$/.test(v)) return resolvePath(v.slice(1, -1));
    if (typeof v === 'string') return v.replace(/\{([^}]+)\}/g, (_, p) => String(resolvePath(p)));
    if (Array.isArray(v)) return v.map(resolveValue);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveValue(x)]));
    }
    return v;
  }
  function resolvePath(path: string): unknown {
    if (resolved.has(path)) return resolved.get(path);
    if (visiting.has(path)) throw new Error(`cyclic token reference "${path}"`);
    const t = byPath.get(path);
    if (!t) throw new Error(`unresolved token reference "${path}"`);
    visiting.add(path);
    const v = resolveValue(t.value);
    visiting.delete(path);
    resolved.set(path, v);
    return v;
  }
  for (const t of flat) resolvePath(t.path);
  return resolved;
}
