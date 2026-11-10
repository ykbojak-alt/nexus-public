/** Состояния процесса/прогона — серверный словарь /v1/processes и
 *  /v1/runs verbatim для неизвестных, русская подпись для известных.
 *  Единая карта: раньше копии жили в rail-agents (STATE_LABEL) и
 *  home (PROC_STATE_LABEL); диалоги выводили status сырьём. */
export const PROC_STATE_LABEL: Partial<Record<string, string>> = {
  running: 'в работе',
  ready: 'готов',
  new: 'запускается',
  blocked: 'заблокирован',
  done: 'завершён',
  failed: 'ошибка',
  cancelled: 'остановлен',
};
