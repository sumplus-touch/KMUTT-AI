import readline from "readline";
import { ask } from "./ask";
import { t, g, rule } from "../ui/theme";

/**
 * Follow-up mode.
 *
 * A professor asking five related questions should not pay startup and
 * connection cost five times. Ctrl-D or "exit" leaves.
 */
export async function watch(opts: { topK?: string; category?: string }) {
  console.log("");
  console.log(`  ${t.brand("kmutt")} ${t.muted("— follow-up mode. Ctrl-D or 'exit' to leave.")}`);
  console.log("");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => rl.setPrompt(`${t.ref(g.arrow)} `) as unknown as void;
  prompt();
  rl.prompt();

  for await (const line of rl) {
    const q = line.trim();
    if (!q) { rl.prompt(); continue; }
    if (/^(exit|quit|:q)$/i.test(q)) break;
    console.log(rule());
    await ask(q, { topK: opts.topK, category: opts.category });
    rl.prompt();
  }

  rl.close();
  console.log("");
  return 0;
}
