/** NEWF — фиксированные роли роя.
 *
 * Модель: 5 мест (seats). Роль — свойство места, не имени: пользователь
 * сажает в окно любой CLI и задаёт имя сам; оркестрация привязана к роли.
 * Привязка живого терминала к месту — лейбл `newf.seat=<seat>` (в mock —
 * поле seat у фикстур).
 *
 *   orchestrator ×1 — план, раздача, контроль
 *   coder        ×2 — код: крупные задачи и точечные патчи
 *   reviewer     ×1 — ревизор и тестер: проверка, тесты, вердикт
 *   short        ×1 — короткий универсал: мелкий код/тест/ревью
 */

export type NewfRole = 'orchestrator' | 'coder' | 'reviewer' | 'short';

export interface RoleSeat {
  /** Стабильный id места: 'orchestrator' | 'coder-1' | 'coder-2' | 'reviewer' | 'short'. */
  seat: string;
  role: NewfRole;
  title: string;
  duties: string[];
}

export const NEWF_SEATS: RoleSeat[] = [
  { seat: 'orchestrator', role: 'orchestrator', title: 'Оркестратор', duties: ['план', 'раздача волн', 'контроль'] },
  { seat: 'coder-1', role: 'coder', title: 'Кодер 1', duties: ['новые файлы', 'крупные задачи'] },
  { seat: 'coder-2', role: 'coder', title: 'Кодер 2', duties: ['патчи', 'точечные правки'] },
  { seat: 'reviewer', role: 'reviewer', title: 'Ревизор/тестер', duties: ['проверка', 'прогон тестов', 'вердикт'] },
  { seat: 'short', role: 'short', title: 'Короткий', duties: ['мелкий код', 'быстрые тесты', 'ревью'] },
];

/** Оркестрация фиксирована по ролям: кто кому может отдать задачу. */
export const ROLE_DISPATCH: Record<NewfRole, NewfRole[]> = {
  orchestrator: ['coder', 'reviewer', 'short'],
  coder: ['reviewer', 'short'],
  reviewer: ['coder', 'short'],
  short: ['reviewer'],
};

const SEAT_INDEX = new Map(NEWF_SEATS.map((s) => [s.seat, s]));

export function seatSpec(seat: string | undefined): RoleSeat | undefined {
  return seat ? SEAT_INDEX.get(seat) : undefined;
}

/** Лейбл терминала → место. Пусто, если лейбла нет или место неизвестно. */
export function seatFromLabels(labels: Record<string, unknown> | undefined): string | undefined {
  const raw = labels?.['newf.seat'];
  const seat = raw != null ? String(raw) : undefined;
  return seat && SEAT_INDEX.has(seat) ? seat : undefined;
}
