/**
 * The whole visual system: colours, glyphs, capability detection.
 *
 * Hand-rolled rather than using picocolors. The design spec calls for exact
 * ANSI-256 tokens (brand 214, ref 39, ok 71 …) and picocolors only exposes the
 * basic 16 colours — the spec's own example silently fell back to `pc.yellow`
 * for KMUTT orange. Emitting the 256-colour codes directly is a few lines and
 * keeps the terminal matching the web app's palette.
 */

/** Colour precedence: NO_COLOR > FORCE_COLOR > --no-color > TTY check. */
function colourEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  if (process.argv.includes("--no-color")) return false;
  return Boolean(process.stdout.isTTY);
}

const COLOUR = colourEnabled();

const code = (open: string) => (s: string) => (COLOUR ? `\x1b[${open}m${s}\x1b[0m` : s);
const fg256 = (n: number) => code(`38;5;${n}`);

/**
 * Semantic colours. Commands should never reach for a raw colour — always a
 * role, so the palette can change in one place.
 */
export const t = {
  brand: fg256(214),   // #f68320 KMUTT orange — labels and command names only
  ref: fg256(39),      // #00acf4 citation numbers, document IDs, links
  ok: fg256(71),       // #3f9142
  warn: fg256(178),    // #c98a00
  stop: fg256(167),    // #ba1a1a
  muted: code("2"),    // dim — paths, timings, scores, hints
  bold: code("1"),
  invert: code("7"),
  /** The one fact per line the reader came for. */
  key: (s: string) => code("1")(s),
};

/**
 * Unicode is not safe everywhere: a Thai-locale cmd.exe on code page 874
 * renders box-drawing glyphs as garbage. Windows Terminal sets WT_SESSION.
 */
const unicodeOk =
  process.platform !== "win32" ||
  Boolean(process.env.WT_SESSION) ||
  process.env.TERM_PROGRAM === "vscode";

export const g = unicodeOk
  ? { ok: "✓", stop: "✗", warn: "!", step: "◆", rail: "│", end: "└", rule: "─", arrow: "❯", bullet: "·" }
  : { ok: "[ok]", stop: "[x]", warn: "[!]", step: "*", rail: "|", end: "`", rule: "-", arrow: ">", bullet: "-" };

/** Spinner frames, with an ASCII fallback for legacy consoles. */
export const spinnerFrames = unicodeOk
  ? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
  : ["-", "\\", "|", "/"];

/** One place decides whether output is for a human. */
export const interactive =
  Boolean(process.stdout.isTTY) && !process.env.CI && !process.argv.includes("--json");

/** Prose width. Never the full terminal — the eye loses the line return. */
export function proseWidth(): number {
  return Math.min((process.stdout.columns ?? 80) - 4, 80);
}

/** Status token: glyph AND colour, never colour alone. */
export function statusLabel(s: string): string {
  if (s === "indexed") return t.ok(`${g.ok} indexed`);
  if (s === "processing") return t.warn(`${g.warn} processing`);
  if (s === "failed") return t.stop(`${g.stop} failed`);
  return t.muted(s);
}

/** OSC 8 hyperlink, degrading to plain text where unsupported. */
export function link(label: string, url: string): string {
  if (!COLOUR || !process.stdout.isTTY) return label;
  return `\x1b]8;;${url}\x07${label}\x1b]8;;\x07`;
}

/** A horizontal rule at prose width. */
export function rule(): string {
  return t.muted(g.rule.repeat(proseWidth()));
}
