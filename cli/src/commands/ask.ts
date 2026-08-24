import { api, ApiError, Hit } from "../api";
import { spinner } from "../ui/spinner";
import { renderSources } from "../ui/sources";
import { t, g, proseWidth } from "../ui/theme";
import { wrap } from "../ui/width";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/**
 * Answer from the knowledge base, with sources.
 *
 * Inverted pyramid: answer first, sources second, diagnostics last. A reader
 * should never scroll past retrieval metadata to reach the sentence they asked
 * for.
 *
 * The server owns generation over websockets; until the CLI speaks that
 * protocol this composes the answer from retrieved passages and always shows
 * where each one came from — which is the part that must never be wrong.
 */
export async function ask(question: string, opts: { json?: boolean; topK?: string; category?: string }) {
  const topK = Math.min(Math.max(parseInt(opts.topK ?? "6", 10) || 6, 1), 20);

  let docCount = 0;
  try {
    docCount = (await api.documents()).length;
  } catch { /* reported below by the search call */ }

  const sp = spinner(docCount ? `Searching ${docCount} documents…` : "Searching…");
  try {
    const res = await api.search(question, topK, opts.category);
    sp.succeed(`Searched ${docCount || "the"} document${docCount === 1 ? "" : "s"}`);

    if (opts.json) {
      console.log(JSON.stringify({ question, ...res }, null, 2));
      return res.count > 0 ? 0 : 1;
    }

    if (res.count === 0) {
      printProblem(en.NO_MATCH(docCount));
      return 1;
    }

    // Number the sources here and keep the answer's markers in step with them.
    const numbered = res.results.map((h, i) => ({ ...h, ref: i + 1 }));
    const width = proseWidth();

    console.log("");
    numbered.slice(0, 3).forEach((h) => {
      const passage = h.text.replace(/\s+/g, " ").trim();
      for (const line of wrap(passage, width)) console.log(line);
      console.log(`${t.ref(`[${h.ref}]`)}`);
      console.log("");
    });

    console.log(renderSources(numbered, api.host()));
    console.log(t.muted(`kmutt show ${numbered[0].fileName ?? ""} to open the full document`));
    console.log("");
    return 0;
  } catch (err: any) {
    sp.fail("Could not answer");
    if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") printProblem(en.NOT_AUTHENTICATED(api.host()));
    else if (err instanceof ApiError && err.code === "SERVER_UNREACHABLE") printProblem(en.SERVER_UNREACHABLE(api.host()));
    else printProblem(en.KB_NOT_CONNECTED());
    return 1;
  }
}
