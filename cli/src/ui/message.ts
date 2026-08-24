import { t, g, proseWidth } from "./theme";
import { wrap } from "./width";

export interface Problem {
  code: string;
  title: string;
  body: string;
  fix: string;
}

/**
 * Every error prints the same three-part shape: what happened, why, what to
 * type next — then a dimmed code that maps to a help page.
 */
export function printProblem(p: Problem): void {
  const width = proseWidth() - 2;
  console.error("");
  console.error(`${t.stop(g.stop)} ${t.key(p.title)}`);
  if (p.body) {
    console.error("");
    for (const line of wrap(p.body, width)) console.error(`  ${line}`);
  }
  if (p.fix) {
    console.error("");
    console.error(`    ${t.brand(p.fix)}`);
  }
  console.error("");
  console.error(`  ${t.muted(p.code)}`);
  console.error("");
}
