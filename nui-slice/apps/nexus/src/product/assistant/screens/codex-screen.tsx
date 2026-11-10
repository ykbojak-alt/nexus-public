// codex-screen.tsx - Assistant Screen for CODEX theme
// WCAG AA Contrast Fixes (contrast >= 4.5:1)
export const codexScreenData = {
  title: 'Assistant - CODEX',
  contrastFixes: {
    fontSize: '17px',       // Было 15px, увеличено для лучшей читаемости
    textColor: '#222222',  // Было #555, более высокий контраст
    backgroundColor: '#ffffff'  // Было #eaeaea, белый фон для лучшего контраста
  }
};