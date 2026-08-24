import readline from "readline";
import { t, g } from "./theme";

function ask(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Plain y/N — for reversible or low-blast-radius actions. */
export async function confirm(question: string, yes = false): Promise<boolean> {
  if (yes) return true;
  const a = await ask(`  ${t.warn(g.warn)} ${question} ${t.muted("[y/N]")} `);
  return /^y(es)?$/i.test(a);
}

/**
 * Type-to-confirm — reserved for shared documents.
 *
 * Escalating friction by blast radius is the rule; making every deletion
 * painful just trains people to reach for --yes.
 */
export async function confirmByTyping(expected: string, label: string, yes = false): Promise<boolean> {
  if (yes) return true;
  const a = await ask(`  ${t.muted("Type the document ID to confirm")} ${t.ref(g.arrow)} `);
  return a === expected;
}

export async function text(question: string, fallback = ""): Promise<string> {
  const a = await ask(`  ${t.brand(g.step)} ${question} ${t.ref(g.arrow)} `);
  return a || fallback;
}

/** Numbered choice — arrow-key menus need raw mode, which pipes poorly. */
export async function select(question: string, options: Array<{ value: string; label: string; hint?: string }>): Promise<string> {
  console.log(`  ${t.brand(g.step)} ${question}`);
  options.forEach((o, i) => {
    console.log(`  ${t.muted(g.rail)}  ${t.ref(String(i + 1))}. ${o.label}${o.hint ? t.muted(`  ${o.hint}`) : ""}`);
  });
  const a = await ask(`  ${t.muted(g.end)} ${t.ref(g.arrow)} `);
  const idx = parseInt(a, 10) - 1;
  return options[idx]?.value ?? options[0].value;
}
