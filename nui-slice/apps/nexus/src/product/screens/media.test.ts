// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseYandex, parseYouTubeId } from './media';

describe('parseYandex — media contract allowlist', () => {
  it('accepts official iframe embed URL', () => {
    expect(parseYandex('https://music.yandex.ru/iframe/#track/12345/678'))
      .toEqual({ kind: 'embed', src: 'https://music.yandex.ru/iframe/#track/12345/678' });
  });

  it('extracts and re-validates src from pasted embed HTML', () => {
    const html = '<iframe src="https://music.yandex.ru/iframe/#track/1/2" width="100%"></iframe><script>alert(1)</script>';
    expect(parseYandex(html)).toEqual({ kind: 'embed', src: 'https://music.yandex.ru/iframe/#track/1/2' });
  });

  it('rejects non-https', () => {
    expect(parseYandex('http://music.yandex.ru/iframe/#track/1/2').kind).toBe('reject');
  });

  it('rejects off-allowlist domains, incl. lookalikes', () => {
    expect(parseYandex('https://evil.example.com/iframe/#track/1').kind).toBe('reject');
    expect(parseYandex('https://music.yandex.ru.evil.com/iframe/#t').kind).toBe('reject');
    expect(parseYandex('https://javascript:alert(1)').kind).toBe('reject');
  });

  it('routes official service pages to external-open fallback', () => {
    expect(parseYandex('https://music.yandex.ru/album/42/track/7'))
      .toEqual({ kind: 'page', src: 'https://music.yandex.ru/album/42/track/7' });
  });

  it('rejects empty and malformed input', () => {
    expect(parseYandex('').kind).toBe('reject');
    expect(parseYandex('not a url at all').kind).toBe('reject');
  });
});

describe('parseYouTubeId', () => {
  it('parses watch / youtu.be / embed / shorts / bare id', () => {
    expect(parseYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
  });

  it('handles mobile host and embed HTML', () => {
    expect(parseYouTubeId('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('dQw4w9WgXcQ');
    expect(parseYouTubeId('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'))
      .toBe('dQw4w9WgXcQ');
  });

  it('rejects non-youtube hosts and non-https', () => {
    expect(parseYouTubeId('https://evil.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('http://youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(parseYouTubeId('https://youtube.com/watch?v=!!bad!!')).toBeNull();
  });
});
