// arch-screen.tsx - Assistant Screen for ARCH theme
// WCAG AA Contrast Fixes (contrast >= 4.5:1)
export const archScreenData = {
  title: 'Assistant - ARCH',
  contrastFixes: {
    fontSize: '18px',       // Было 16px, увеличено для лучшей читаемости
    textColor: '#333333',  // Было #666, повышенный контраст
    backgroundColor: '#ffffff'  // Было #f8f9fa, белый фон для лучшего контраста
  }
};