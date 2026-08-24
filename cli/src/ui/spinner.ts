import { spinnerFrames, t, g, interactive } from "./theme";

/**
 * A spinner that knows when to keep quiet.
 *
 * When output is piped or --json is set it prints nothing at all — no frames,
 * no cursor movement — so redirected output stays clean.
 */
export function spinner(text: string) {
  let i = 0;
  let timer: NodeJS.Timeout | null = null;
  let current = text;
  const started = Date.now();

  if (interactive) {
    process.stdout.write("\x1b[?25l"); // hide cursor
    timer = setInterval(() => {
      const frame = spinnerFrames[(i = (i + 1) % spinnerFrames.length)];
      process.stdout.write(`\r${t.brand(frame)} ${current}\x1b[K`);
    }, 80);
  }

  const clear = () => {
    if (timer) clearInterval(timer);
    timer = null;
    if (interactive) process.stdout.write(`\r\x1b[K\x1b[?25h`); // clear line, show cursor
  };

  return {
    update(next: string) {
      current = next;
    },
    succeed(msg?: string) {
      clear();
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      if (interactive) console.log(`${t.ok(g.ok)} ${msg ?? current} ${t.muted(`${secs}s`)}`);
    },
    fail(msg?: string) {
      clear();
      if (interactive) console.log(`${t.stop(g.stop)} ${msg ?? current}`);
    },
    stop: clear,
  };
}
