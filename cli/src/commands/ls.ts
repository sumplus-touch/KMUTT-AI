import { api } from "../api";
import { t, g, interactive } from "../ui/theme";
import { table, truncate } from "../ui/width";
import { statusLabel } from "../ui/theme";

/**
 * List documents.
 *
 * Two deliberate choices: failures are repeated below the table in full prose
 * (a table cell can never hold an actionable explanation), and the summary
 * ends with "N need attention" rather than making the reader count red rows.
 */
export async function ls(opts: { json?: boolean; category?: string }) {
  let docs = await api.documents();
  if (opts.category) docs = docs.filter((d) => d.category === opts.category);

  if (opts.json) {
    console.log(JSON.stringify(docs, null, 2));
    return 0;
  }

  if (docs.length === 0) {
    console.log("");
    console.log(`  ${t.muted("No documents yet.")}`);
    console.log(`  ${t.brand("kmutt add <file>")} ${t.muted("to add one.")}`);
    console.log("");
    return 0;
  }

  const rows = docs.map((d) => [
    t.ref(d.id.slice(0, 6)),
    d.title,
    d.category,
    String(d.chunkCount),
    d.fileMissing ? t.warn(`${g.warn} file missing`) : statusLabel(d.status),
  ]);

  console.log("");
  // Thai titles go in a column with a hard cap so a fallback font that
  // measures wide cannot push the columns to its right out of alignment.
  console.log(table(["ID", "TITLE", "CATEGORY", "CHUNKS", "STATUS"], rows, { maxWidths: [6, 42, 12, 6, 20] }));

  const chunks = docs.reduce((n, d) => n + d.chunkCount, 0);
  const bad = docs.filter((d) => d.status === "failed" || d.fileMissing);
  console.log("");
  console.log(
    t.muted(
      `${docs.length} documents ${g.bullet} ${chunks} chunks` +
        (bad.length ? ` ${g.bullet} ${bad.length} need attention` : "")
    )
  );

  for (const d of bad.slice(0, 5)) {
    console.log("");
    console.log(`${t.stop(g.stop)} ${t.key(truncate(d.title, 52))}`);
    const why = d.fileMissing
      ? "The source file is no longer in the workspace, so it cannot be previewed or re-indexed."
      : d.error || "Indexing failed.";
    console.log(`  ${t.muted(why)}`);
    console.log(`  ${t.brand(`kmutt reindex ${d.id.slice(0, 6)}`)}`);
  }
  console.log("");
  return 0;
}
