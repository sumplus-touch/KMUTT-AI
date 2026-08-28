import { api, ApiError } from "../api";
import { spinner } from "../ui/spinner";
import { confirm } from "../ui/prompt";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/**
 * Add page numbers to documents indexed before page tracking existed.
 *
 * Patches metadata on the existing vectors — nothing is re-embedded, so this
 * costs no Pinecone usage and leaves the embeddings untouched. Only paged
 * formats (PDF, Excel) can gain a page.
 */
export async function backfillPages(id: string | undefined, opts: { json?: boolean; yes?: boolean }) {
  if (!opts.json) {
    console.log("");
    console.log(`  ${t.brand("kmutt backfill-pages")}`);
    console.log(`    ${t.muted("Adds page numbers to existing chunks by patching metadata only.")}`);
    console.log(`    ${t.muted("No re-embedding, so there is no Pinecone usage cost.")}`);
    console.log("");
    if (!(await confirm(id ? "Backfill this document?" : "Backfill every document?", opts.yes))) {
      console.log(`  ${t.muted("Cancelled.")}`);
      return 1;
    }
  }

  const sp = spinner("Patching page metadata…");
  try {
    const res: any = await api.backfillPages(id);
    sp.succeed(`Patched ${res.chunksPatched} chunks across ${res.documents} documents`);

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return res.failed ? 1 : 0;
    }

    console.log("");
    console.log(`  ${t.ok(g.ok)} ${res.chunksPatched} chunks now carry a page number`);
    if (res.skipped) console.log(`  ${t.muted(`${res.skipped} skipped (no pages, or source file missing)`)}`);
    if (res.failed) console.log(`  ${t.warn(g.warn)} ${res.failed} failed`);
    for (const p of res.problems ?? []) console.log(`    ${t.muted(`${p.title}: ${p.why}`)}`);
    console.log("");
    return res.failed ? 1 : 0;
  } catch (err: any) {
    sp.fail("Backfill failed");
    if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") printProblem(en.NOT_AUTHENTICATED(api.host()));
    else printProblem({ code: "BACKFILL_FAILED", title: "Could not backfill page numbers", body: err.message, fix: "kmutt doctor" });
    return 1;
  }
}
