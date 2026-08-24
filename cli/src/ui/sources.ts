import { t, g, link, rule, proseWidth } from "./theme";
import { wrap } from "./width";
import type { Hit } from "../api";

/**
 * The citation block.
 *
 * This is the product promise — an answer you can trace to the clause it came
 * from — so it is the part that never gets compressed when output needs to be
 * denser.
 *
 * Reference numbers come from the server's turn-scoped registry and are never
 * recomputed here: renumbering client-side would break the correspondence
 * between an inline [2] in the answer and entry 2 in this list.
 */
export function renderSources(hits: Array<Hit & { ref?: number }>, host: string): string {
  if (hits.length === 0) return "";

  const out: string[] = ["", rule(), t.brand("Sources"), ""];

  hits.forEach((h, i) => {
    const ref = h.ref ?? i + 1;
    const url = `${host}/sandbox/${encodeURI(h.fileName ?? "")}${h.page ? `#page=${h.page}` : ""}`;
    const title = link(h.title || h.fileName || "Untitled", url);

    // Only the parts that exist — never "p.undefined".
    const facts = [
      h.page != null ? `p.${h.page}` : null,
      h.score != null ? `${Math.round(h.score * 100)}% match` : null,
    ]
      .filter(Boolean)
      .join(` ${g.bullet} `);

    out.push(`${t.ref(`[${ref}]`)} ${t.key(title)}`);
    if (facts) out.push(`    ${t.muted(facts)}`);
    if (h.fileName) out.push(`    ${t.muted(h.fileName)}`);
    out.push("");
  });

  return out.join("\n");
}

/** Matching passages only — `kmutt search`, no AI answer. */
export function renderPassages(hits: Hit[]): string {
  const out: string[] = [];
  const width = proseWidth() - 4;

  hits.forEach((h, i) => {
    const facts = [h.page != null ? `p.${h.page}` : null, `${Math.round(h.score * 100)}%`]
      .filter(Boolean)
      .join(` ${g.bullet} `);

    out.push(`${t.ref(`[${i + 1}]`)} ${t.key(h.title || h.fileName || "Untitled")}  ${t.muted(facts)}`);
    for (const line of wrap(h.text.replace(/\s+/g, " ").trim(), width)) {
      out.push(`    ${line}`);
    }
    out.push("");
  });

  return out.join("\n");
}
