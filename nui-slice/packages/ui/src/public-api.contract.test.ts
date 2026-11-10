import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import type {
  AssistantThemeId,
  CompactBadgeProps,
  CompactBlockProps,
  CompactIndicatorPattern,
  CompactIndicatorProps,
  CompactState,
  CompactSummaryRowProps,
  EmptyStateProps,
  ErrorStateProps,
  GlassSurfaceProps,
  LoadingStateProps,
  NexusThemeDefinition,
  NexusThemeId,
  TokenKey,
  UnavailableStateProps,
} from '@nexus/ui';

// Compile-time witnesses ensure these consumer types stay reachable at root.
type PublicTypeContract = [
  AssistantThemeId,
  CompactBadgeProps,
  CompactBlockProps,
  CompactIndicatorPattern,
  CompactIndicatorProps,
  CompactState,
  CompactSummaryRowProps,
  EmptyStateProps,
  ErrorStateProps,
  GlassSurfaceProps,
  LoadingStateProps,
  NexusThemeDefinition,
  NexusThemeId,
  TokenKey,
  UnavailableStateProps,
];
const publicTypeContract: PublicTypeContract | undefined = undefined;
void publicTypeContract;

const PACKAGE_JSON = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_SNAPSHOT = join(PACKAGE_ROOT, 'public-api.json');

function collectExports(entry: string, visited = new Set<string>()): string[] {
  const file = resolve(entry);
  if (visited.has(file)) return [];
  visited.add(file);
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) names.push(specifier.name.text);
        continue;
      }
      if (statement.exportClause || !statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      if (!specifier.startsWith('.')) continue;
      const base = resolve(dirname(file), specifier);
      const candidates = [
        `${base}.ts`, `${base}.tsx`, `${base}.js`,
        join(base, 'index.ts'), join(base, 'index.tsx'),
      ];
      const target = candidates.find(existsSync);
      if (target) {
        names.push(...collectExports(target, visited));
      }
      continue;
    }
    const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) : undefined;
    if (!modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) continue;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
      }
    } else if (
      (ts.isClassDeclaration(statement)
        || ts.isFunctionDeclaration(statement)
        || ts.isInterfaceDeclaration(statement)
      || ts.isTypeAliasDeclaration(statement)
      || ts.isEnumDeclaration(statement))
      && statement.name != null
    ) {
      names.push(statement.name.text);
    }
  }
  return names;
}

describe('@nexus/ui public API contract', () => {
  it('publishes the root API plus reviewed accessibility primitive subpaths', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')) as {
      main?: string;
      types?: string;
      exports?: Record<string, string>;
    };
    expect(pkg.exports).toEqual({
      '.': './src/index.ts',
      './accessibility/scroll-region': './src/accessibility/scroll-region.tsx',
      './accessibility/list': './src/accessibility/list.tsx',
      './inputs/listbox': './src/inputs/listbox/listbox.tsx',
      './navigation/tabs': './src/navigation/tabs/tabs.tsx',
      './navigation/tabs-primitives': './src/navigation/tabs/tab-primitives.tsx',
      './charts/donut-chart': './src/charts/donut-chart/donut-chart.tsx',
      './charts/flow-steps': './src/charts/flow-steps/flow-steps.tsx',
      './motion': './src/motion/motion-wrappers.tsx',
      './surfaces/modal': './src/surfaces/modal/modal.tsx',
      './surfaces/drawer': './src/surfaces/drawer/drawer.tsx',
      './actions/action-menu': './src/actions/action-menu/action-menu.tsx',
      './surfaces/tooltip': './src/surfaces/tooltip/tooltip.tsx',
      './compaction': './src/compaction/index.ts',
      './panel-header': './src/panel-header/index.ts',
    });
    expect(pkg.main).toBe('./src/index.ts');
    expect(pkg.types).toBe('./src/index.ts');
  });

  it('matches the reviewed root export snapshot with no duplicate names', () => {
    const snapshot = JSON.parse(readFileSync(API_SNAPSHOT, 'utf8')) as {
      contractVersion: number;
      entry: string;
      exports: string[];
    };
    const names = collectExports(join(PACKAGE_ROOT, 'src/index.ts')).sort();

    expect(snapshot.contractVersion).toBe(1);
    expect(snapshot.entry).toBe('@nexus/ui');
    expect(new Set(names).size, 'duplicate exported identifier found').toBe(names.length);
    expect(names).toEqual(snapshot.exports);
  });
});
