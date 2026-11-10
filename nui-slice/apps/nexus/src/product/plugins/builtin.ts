/**
 * Регистрация встроенных («официальных») плагинов NEU. Импорт модуля —
 * побочный эффект: назначает загрузчик хосту до первого getPluginHost().
 */
import { setBuiltinPlugins } from './plugin-host';
import { HOME_WIDGETS_PLUGIN } from './builtin-home-widgets';
import { RIGHTBAR_TABS_PLUGIN } from './builtin-rightbar-tabs';

setBuiltinPlugins(() => [HOME_WIDGETS_PLUGIN, RIGHTBAR_TABS_PLUGIN]);

export { HOME_WIDGETS_PLUGIN } from './builtin-home-widgets';
export { RIGHTBAR_TABS_PLUGIN } from './builtin-rightbar-tabs';
