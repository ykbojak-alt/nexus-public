import type { NexusThemeDefinition } from './types';

/**
 * Extension API: a future agent theme is created here, never by forking
 * @nexus/ui components. Missing `extends` means 'nexus'.
 */
export function createNexusTheme(input: NexusThemeDefinition): NexusThemeDefinition {
  if (!input || typeof input.id !== 'string' || input.id.trim() === '') {
    throw new Error('createNexusTheme: theme id must be a non-empty string');
  }
  const id = input.id.trim();
  return {
    id,
    extends: input.extends ?? 'nexus',
    description: input.description,
    tokens: { ...input.tokens },
  };
}
