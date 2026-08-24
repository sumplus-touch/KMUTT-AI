import { api } from "../api";
import { resolveId } from "./show";
import { spinner } from "../ui/spinner";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/** Re-process a document — needed after the source changed, or to add page numbers. */
export async function reindex(id: string, opts: { json?: boolean; all?: boolean }) {
  const { docs, hits } = await resolveId(id ?? "");
  const targets = opts.all ? docs : hits;

  if (!opts.all && targets.length === 0) {
    printProblem(en.DOC_NOT_FOUND(id));
    return 1;
  }

  let ok = 0;
  const failed: string[] = [];

  for (let i = 0; i < targets.length; i++) {
    const d = targets[i];
    const sp = spinner(`Re-indexing ${d.title} ${t.muted(`(${i + 1}/${targets.length})`)}`);
    try {
      const res = await api.reindex(d.id);
      sp.succeed(`${d.title} ${t.muted(`${res.document.chunkCount} chunks`)}`);
      ok++;
    } catch (err: any) {
      sp.fail(`${d.title}`);
      failed.push(`${d.title}: ${err.message}`);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ reindexed: ok, failed }, null, 2));
  } else {
    console.log("");
    console.log(t.muted(`${ok} re-indexed${failed.length ? ` ${g.bullet} ${failed.length} failed` : ""}`));
    for (const f of failed.slice(0, 5)) console.log(`  ${t.stop(g.stop)} ${f}`);
    console.log("");
  }
  return failed.length ? 1 : 0;
}
