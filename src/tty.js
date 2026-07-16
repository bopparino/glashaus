// Terminal paint — the instrument aesthetic in ANSI. Brass for the companion
// and for emphasis, faint for machinery, plain ink for words. Colors switch
// off for pipes and NO_COLOR; every helper degrades to identity.
const on = process.stdout.isTTY && !process.env.NO_COLOR;

const wrap = (open, close) => s => (on ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const brass = wrap('38;2;228;184;74', '39');
export const faint = wrap('38;5;243', '39');
export const ink = wrap('39', '39');
export const bold = wrap('1', '22');
export const italic = wrap('3', '23');
export const red = wrap('38;2;229;64;31', '39');
export const green = wrap('38;2;120;160;100', '39');

export const rule = (w = 44) => faint('─'.repeat(w));
export const isTTY = on;

// Redraw support: erase the last n terminal rows (streaming repair).
export function eraseLines(n) {
  if (!on || n <= 0) return;
  process.stdout.write(`\x1b[${n}A\x1b[0J`);
}

// How many terminal rows a string occupies at the current width.
export function rowsOf(text, columns = process.stdout.columns || 80) {
  let rows = 0;
  for (const line of String(text).split('\n')) {
    rows += Math.max(1, Math.ceil((line.length || 1) / columns));
  }
  return rows;
}
