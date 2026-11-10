'use client';

/**
 * W50: agent-badge — детект CLI в терминале по имени и last_line.
 *
 * Эвристика по маркерам промптов/имён: devin/codex/claude/qwen/pwsh.
 */

export interface AgentDetect { key: string; name: string; icon: string; }

const AGENTS: AgentDetect[] = [
  { key: 'devin', name: 'Devin', icon: '🛠' },
  { key: 'codex', name: 'Codex', icon: '📐' },
  { key: 'claude', name: 'Claude', icon: '✳️' },
  { key: 'qwen', name: 'Qwen', icon: '🌙' },
  { key: 'pwsh', name: 'PowerShell', icon: '⚡' },
  { key: 'bash', name: 'Bash', icon: '❯' },
  { key: 'fish', name: 'Fish', icon: '❯' },
];

/** Промпт-маркеры по ключу. */
const PROMPT_RE: Record<string, RegExp> = {
  devin: /devin[>\]]/i,
  codex: /codex[>\]]/i,
  claude: /claude[>\]]/i,
  qwen: /qwen[>\]]/i,
  pwsh: /PS [A-Z]:[\\/]/i,
  bash: /^\$\s|^❯\s|^\$\sKe.+/m,
};

/**
 * Детект агента. Приоритет: имя в названии терминала → маркер промпта
 * в last_line → shell-маркеры. Возвращает null, если ничего не похоже
 * (включая пустой/generic промпт — не приписываем неизвестное shell'у).
 */
export function detectAgent(name: string, lastLine: string): AgentDetect | null {
  const hayName = name.toLowerCase();
  for (const a of AGENTS) {
    if (hayName.includes(a.key)) return a;
    if (a.key !== 'bash' && a.key !== 'fish' && hayName.includes(a.name.toLowerCase())) return a;
  }
  for (const a of AGENTS) {
    const re = PROMPT_RE[a.key];
    if (re && re.test(lastLine)) return a;
  }
  return null;
}

export default detectAgent;
