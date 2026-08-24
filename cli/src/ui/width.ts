/**
 * Thai-aware width, padding and wrapping.
 *
 * Thai combining marks take no horizontal space but each counts as one in
 * String.length, so padding a column by .length pushes every Thai row left by
 * the number of marks it contains. Thai also has no spaces between words, so a
 * naive wrap splits words mid-syllable and can strand a tone mark alone on a
 * line.
 *
 *   U+0E31          MAI HAN AKAT
 *   U+0E34–U+0E3A   above/below vowels
 *   U+0E47–U+0E4E   tone marks, thanthakhat, nikhahit
 */
const THAI_COMBINING = /[ัิ-ฺ็-๎]/g;
const ANSI = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x07]*\x07/g;

/** Printable columns a string occupies, ignoring ANSI and zero-width marks. */
export function visualWidth(s: string): number {
  return [...s.replace(ANSI, "").replace(THAI_COMBINING, "")].length;
}

/** Pad right to a column count, measured visually. */
export function pad(s: string, n: number): string {
  return s + " ".repeat(Math.max(0, n - visualWidth(s)));
}

/** Truncate to a visual width, appending an ellipsis when it does not fit. */
export function truncate(s: string, n: number): string {
  if (visualWidth(s) <= n) return s;
  let out = "";
  for (const ch of s.replace(ANSI, "")) {
    if (visualWidth(out + ch) > n - 1) break;
    out += ch;
  }
  return out + "…";
}

/**
 * Wrap on legal word boundaries.
 *
 * Intl.Segmenter (Node 18+ with full ICU) knows where Thai words break; for
 * scripts that use spaces it behaves like an ordinary word wrap. Falls back to
 * whitespace splitting if the runtime lacks a segmenter.
 */
export function wrap(text: string, max: number, locale = "th"): string[] {
  const paragraphs = text.split("\n");
  const out: string[] = [];

  for (const para of paragraphs) {
    if (para.trim() === "") {
      out.push("");
      continue;
    }

    let segments: string[];
    try {
      const seg = new Intl.Segmenter(locale, { granularity: "word" });
      segments = [...seg.segment(para)].map((x) => x.segment);
    } catch {
      segments = para.split(/(\s+)/);
    }

    let line = "";
    for (const s of segments) {
      if (visualWidth(line + s) > max && line.trim()) {
        out.push(line.trimEnd());
        line = s.trimStart();
      } else {
        line += s;
      }
    }
    if (line.trim()) out.push(line.trimEnd());
  }
  return out;
}

/**
 * A padded table.
 *
 * Hand-rolled deliberately: cli-table3 does not let you override its width
 * function, so it measures Thai titles by String.length and misaligns every
 * row that contains combining marks.
 */
export function table(headers: string[], rows: string[][], opts: { maxWidths?: number[] } = {}): string {
  const cols = headers.length;
  const widths: number[] = [];

  for (let i = 0; i < cols; i++) {
    const cap = opts.maxWidths?.[i] ?? Infinity;
    const natural = Math.max(visualWidth(headers[i]), ...rows.map((r) => visualWidth(r[i] ?? "")));
    widths[i] = Math.min(natural, cap);
  }

  const line = (cells: string[]) =>
    cells
      .map((cell, i) => (i === cols - 1 ? truncate(cell, widths[i]) : pad(truncate(cell, widths[i]), widths[i])))
      .join("  ")
      .trimEnd();

  return [line(headers), ...rows.map(line)].join("\n");
}
