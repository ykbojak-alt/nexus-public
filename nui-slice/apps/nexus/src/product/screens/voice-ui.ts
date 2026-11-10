/**
 * VoiceUiContext — общий мост между shell-экранами NEWF и голосовой
 * панелью (app/newf/voice-panel.tsx). Экран рендерит кнопку-тоггл,
 * панель рендерится гейтом под экраном (в потоке, не поверх).
 */

import { createContext, useContext } from 'react';

export interface VoiceUiState {
  open: boolean;
  setOpen: (open: boolean) => void;
  /** Мост задан (live/query bridge) — панель вообще доступна. */
  active: boolean;
}

export const VoiceUiContext = createContext<VoiceUiState>({
  open: false,
  setOpen: () => {},
  active: false,
});

export function useVoiceUi(): VoiceUiState {
  return useContext(VoiceUiContext);
}
