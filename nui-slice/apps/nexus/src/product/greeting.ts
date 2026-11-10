/** Время суток по локальному часу — общий источник для /home и /welcome
 *  (runtime-wave2 2a). Честная часть приветствия: только часы клиента. */
export function greetingOf(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Добрый день';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
}
