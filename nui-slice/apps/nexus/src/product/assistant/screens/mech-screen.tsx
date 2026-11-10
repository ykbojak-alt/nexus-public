// mech-screen.tsx - Assistant Screen for MECH theme
// WCAG AA Contrast Fixes (contrast >= 4.5:1)
export const mechScreenData = {
  title: 'Assistant - MECH',
  contrastFixes: {
    fontSize: '16px',       // Было 14px, увеличено для лучшей читаемости
    textColor: '#333333',  // Было #777, повышенный контраст
    backgroundColor: '#ffffff'  // Было #f0f0f0, белый фон для лучшего контраста
  }
};