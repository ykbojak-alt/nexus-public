/** Главный экран каждой персоны (start-экран → экран выбранного ассистента).
 *  AGENT-A — /home (приоритет Yury 16.10, alice-first); остальные —
 *  листы раздела Agents. Неизвестная персона → /home (экран среды). */
export const PERSONA_HOME: Readonly<Record<string, string>> = {
  alice: '/home',
  arch: '/arch',
  mech: '/mech',
  codex: '/codex',
  forge: '/forge',
};

export function personaHome(id: string): string {
  return PERSONA_HOME[id] ?? '/home';
}
