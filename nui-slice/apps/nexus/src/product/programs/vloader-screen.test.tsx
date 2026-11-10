// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VLoaderScreen } from './vloader-screen';

describe('VLoaderScreen', () => {
  it('shows local CLI setup commands and does not claim browser downloads', () => {
    render(<VLoaderScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'NEXUS VLOADER' })).toBeTruthy();
    expect(screen.getByText('npm install --global yoinks')).toBeTruthy();
    expect(screen.getByText('yoinks')).toBeTruthy();
    expect(screen.getByText(/не передаёт URL или видео через/)).toBeTruthy();
    expect(screen.getByText(/Используйте только разрешённый контент/)).toBeTruthy();
  });

  it('links to the upstream repository safely', () => {
    render(<VLoaderScreen />);

    const link = screen.getByRole('link', { name: /Репозиторий GitHub/ });
    expect(link.getAttribute('href')).toBe('https://github.com/pablostanley/yoinks');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
