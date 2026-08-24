import { api } from "../api";
import { t, g, rule } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";
import { wrap } from "../ui/width";

/** Resolve a short ID prefix to one document, as `ls` displays 6 characters. */
export async function resolveId(idOrPrefix: string) {
  const docs = await api.documents();
  const hits = docs.filter((d) => d.id === idOrPrefix || d.id.startsWith(idOrPrefix));
  return { docs, hits };
}

export async function show(id: string, opts: { json?: boolean }) {
  const { hits } = await resolveId(id);
  if (hits.length === 0) {
    printProblem(en.DOC_NOT_FOUND(id));
    return 1;
  }
  if (hits.length > 1) {
    printProblem({
      code: "ID_AMBIGUOUS",
      title: `"${id}" matches ${hits.length} documents`,
      body: hits.slice(0, 5).map((h) => `${h.id.slice(0, 8)}  ${h.title}`).join("\n"),
      fix: "Use more characters of the ID.",
    });
    return 1;
  }

  const d = hits[0];
  if (opts.json) {
    console.log(JSON.stringify(d, null, 2));
    return 0;
  }

  const row = (k: string, v: string) => console.log(`  ${t.muted(k.padEnd(12))} ${v}`);
  console.log("");
  console.log(`  ${t.key(d.title)}`);
  console.log("");
  row("ID", t.ref(d.id));
  row("Category", d.category);
  row("File", d.fileName);
  row("Size", `${(d.fileSize / 1024).toFixed(0)} KB`);
  row("Chunks", String(d.chunkCount));
  row("Status", d.fileMissing ? t.warn(`${g.warn} source file missing`) : d.status);
  row("Access", d.access);
  row("Indexed", d.indexedAt ? new Date(d.indexedAt).toLocaleString() : "—");

  if (d.error) {
    console.log("");
    console.log(rule());
    for (const line of wrap(d.error, 74)) console.log(`  ${t.stop(line)}`);
    console.log("");
    console.log(`  ${t.brand(`kmutt reindex ${d.id.slice(0, 6)}`)}`);
  }
  console.log("");
  return 0;
}
