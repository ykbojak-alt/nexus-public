/**
 * Small fixed-grid renderer for the tail text returned by the NEWF bridge.
 *
 * Supports printable characters, CR/LF/backspace, deferred right-edge wrap,
 * CSI cursor movement/positioning, display/line erase, and SGR stripping.
 * Private-mode CSI and OSC title sequences are discarded. This is deliberately
 * not a VT emulator: it has no alternate screen, colors, attributes, wide-cell
 * Unicode layout, insert/delete operations, or persistent cursor between polls.
 */
export function renderAnsiScreen(raw: string, cols: number, rows: number): string[] {
  const width = Number.isFinite(cols) ? Math.max(1, Math.floor(cols)) : 120;
  const height = Number.isFinite(rows) ? Math.max(1, Math.floor(rows)) : 24;
  const blankRow = () => Array<string>(width).fill(' ');
  const grid = Array.from({ length: height }, blankRow);
  let x = 0;
  let y = 0;
  let wrapPending = false;

  const scrollIntoView = () => {
    while (y >= height) {
      grid.shift();
      grid.push(blankRow());
      y -= 1;
    }
    if (y < 0) y = 0;
  };

  const nextLine = () => {
    y += 1;
    wrapPending = false;
    scrollIntoView();
  };

  const write = (value: string) => {
    if (wrapPending) {
      x = 0;
      nextLine();
    }
    grid[y][x] = value;
    if (x === width - 1) wrapPending = true;
    else x += 1;
  };

  const eraseDisplay = (mode: number) => {
    if (mode === 2) {
      for (let row = 0; row < height; row += 1) grid[row].fill(' ');
      return;
    }
    if (mode === 0) {
      grid[y].fill(' ', x);
      for (let row = y + 1; row < height; row += 1) grid[row].fill(' ');
      return;
    }
    if (mode === 1) {
      for (let row = 0; row < y; row += 1) grid[row].fill(' ');
      grid[y].fill(' ', 0, Math.min(width, x + 1));
    }
  };

  const eraseLine = (mode: number) => {
    if (mode === 0) grid[y].fill(' ', x);
    else if (mode === 1) grid[y].fill(' ', 0, Math.min(width, x + 1));
    else if (mode === 2) grid[y].fill(' ');
  };

  const handleCsi = (body: string, final: string) => {
    // Terminal-private modes (for example ?9001h / ?25l) are intentionally ignored.
    if (/^[?<=>]/.test(body)) return;
    const params = body.split(';').map((part) => {
      const value = Number.parseInt(part, 10);
      return Number.isFinite(value) ? value : 0;
    });
    const first = params[0] || 1;
    wrapPending = false;

    switch (final) {
      case 'A': y = Math.max(0, y - first); break;
      case 'B': y = Math.min(height - 1, y + first); break;
      case 'C': x = Math.min(width - 1, x + first); break;
      case 'D': x = Math.max(0, x - first); break;
      case 'H':
      case 'f':
        y = Math.max(0, Math.min(height - 1, (params[0] || 1) - 1));
        x = Math.max(0, Math.min(width - 1, (params[1] || 1) - 1));
        break;
      // CHA (CSI n G): cursor horizontal absolute — колонка n (1-based).
      case 'G':
        x = Math.max(0, Math.min(width - 1, first - 1));
        break;
      // VPA (CSI n d): vertical position absolute — строка n (1-based).
      case 'd':
        y = Math.max(0, Math.min(height - 1, first - 1));
        break;
      case 'J': eraseDisplay(params[0] || 0); break;
      case 'K': eraseLine(params[0] || 0); break;
      // ICH (CSI n @) — вставить n пробелов на позиции курсора; содержимое
      // строки сдвигается вправо, крайние n ячеек справа теряются.
      case '@': {
        const n = first;
        const row = grid[y];
        for (let k = width - 1; k >= x + n; k -= 1) row[k] = row[k - n] ?? ' ';
        for (let k = x; k < Math.min(width, x + n); k += 1) row[k] = ' ';
        break;
      }
      // DCH (CSI n P) — удалить n символов с позиции курсора; содержимое
      // сдвигается влево, справа строка дополняется пробелами.
      case 'P': {
        const n = first;
        const row = grid[y];
        for (let k = x; k + n < width; k += 1) row[k] = row[k + n];
        for (let k = Math.max(x, width - n); k < width; k += 1) row[k] = ' ';
        break;
      }
      // ECH (CSI n X) — стереть n символов от курсора (курсор не двигается).
      case 'X': {
        const n = first;
        grid[y].fill(' ', x, Math.min(width, x + n));
        break;
      }
      // REP (CSI n b): повторить последний напечатанный символ n раз.
      case 'b': {
        const n = first;
        const lastChar = x > 0 ? (grid[y][x - 1] || ' ') : ' ';
        for (let i = 0; i < n; i += 1) {
          if (wrapPending) {
            x = 0;
            nextLine();
          }
          grid[y][x] = lastChar;
          if (x === width - 1) wrapPending = true;
          else x += 1;
        }
        break;
      }
      case 'm': // SGR styling is omitted; preserve only the text cells.
      default: // Unknown CSI sequences are consumed without rendering.
        break;
    }
  };

  for (let index = 0; index < raw.length;) {
    const code = raw.charCodeAt(index);
    const current = raw[index];

    if (code === 0x1b) {
      const introducer = raw[index + 1];
      if (introducer === '[') {
        let end = index + 2;
        while (end < raw.length) {
          const finalCode = raw.charCodeAt(end);
          if (finalCode >= 0x40 && finalCode <= 0x7e) break;
          end += 1;
        }
        if (end < raw.length) handleCsi(raw.slice(index + 2, end), raw[end]);
        index = Math.min(raw.length, end + 1);
        continue;
      }
      if (introducer === ']') {
        let end = index + 2;
        while (end < raw.length) {
          if (raw.charCodeAt(end) === 0x07 || raw.charCodeAt(end) === 0x9c) {
            end += 1;
            break;
          }
          if (raw.charCodeAt(end) === 0x1b && raw[end + 1] === '\\') {
            end += 2;
            break;
          }
          end += 1;
        }
        index = end;
        continue;
      }
      // Discard other two-byte ESC sequences; this view does not emulate them.
      index += Math.min(2, raw.length - index);
      continue;
    }

    if (current === '\r') {
      x = 0;
      wrapPending = false;
      index += 1;
      continue;
    }
    if (current === '\n') {
      nextLine();
      index += 1;
      continue;
    }
    if (current === '\b') {
      x = Math.max(0, x - 1);
      wrapPending = false;
      index += 1;
      continue;
    }
    if (code < 0x20 || code === 0x7f || code === 0x9b) {
      // C0/C1 controls not listed above are ignored (C1 CSI is not interpreted).
      index += 1;
      continue;
    }

    const point = raw.codePointAt(index)!;
    const char = String.fromCodePoint(point);
    write(char);
    index += char.length;
  }

  const rawLines = grid.map((line) => line.join('').replace(/ +$/, ''));
  // Скрыть bootstrap-эхо нового терминала (python.exe / nx_exec_shim / spec.json).
  let startIdx = 0;
  while (startIdx < rawLines.length && (rawLines[startIdx].includes('python.exe') || rawLines[startIdx].includes('nx_exec_shim') || rawLines[startIdx].includes('spec.json'))) {
    startIdx += 1;
  }
  return rawLines.slice(startIdx);
}
