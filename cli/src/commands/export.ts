import fs from "fs";
import path from "path";
import { api } from "../api";
import { load } from "../config";
import { spinner } from "../ui/spinner";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/**
 * Export the knowledge base as a portable bundle.
 *
 * The registry lives in a Docker volume and the PDFs live in another, so a
 * redeploy carries neither — only the Pinecone vectors follow, which is why a
 * fresh server shows zero documents next to a full chunk count. The bundle
 * pairs the registry with its source files so a move carries everything.
 *
 *   <out>/manifest.json     what this bundle is and where it came from
 *   <out>/knowledge.json    the document registry
 *   <out>/files/…           every source document
 */
export async function exportBundle(outDir: string, opts: { json?: boolean; skipFiles?: boolean }) {
  const dest = path.resolve(outDir);
  const filesDir = path.join(dest, "files");

  let docs;
  try {
    docs = await api.documents();
  } catch (err: any) {
    printProblem(err.code === "NOT_AUTHENTICATED" ? en.NOT_AUTHENTICATED(api.host()) : en.SERVER_UNREACHABLE(api.host()));
    return 1;
  }

  if (docs.length === 0) {
    console.log("");
    console.log(`  ${t.warn(g.warn)} Nothing to export — the knowledge base is empty.`);
    console.log("");
    return 1;
  }

  fs.mkdirSync(filesDir, { recursive: true });

  let status: any = null;
  try { status = await api.status(); } catch { /* index details are best-effort */ }

  // Registry first: it is the small, essential half of the bundle.
  fs.writeFileSync(path.join(dest, "knowledge.json"), JSON.stringify(docs, null, 2), "utf-8");

  const { host, token } = load();
  const saved: string[] = [];
  const missing: string[] = [];

  if (!opts.skipFiles) {
    const sp = spinner(`Downloading ${docs.length} files…`);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      sp.update(`Downloading ${i + 1}/${docs.length} ${t.muted(d.fileName)}`);
      if (d.fileMissing) { missing.push(d.fileName); continue; }
      try {
        const url = `${host}/api/files/download?path=${encodeURIComponent(d.filePath)}`;
        const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
        if (!res.ok) { missing.push(d.fileName); continue; }
        const buf = Buffer.from(await res.arrayBuffer());
        // Store under the document id so two documents sharing a filename
        // cannot overwrite each other in the bundle.
        fs.writeFileSync(path.join(filesDir, `${d.id}__${d.fileName}`), buf);
        saved.push(d.fileName);
      } catch {
        missing.push(d.fileName);
      }
    }
    sp.succeed(`Downloaded ${saved.length}/${docs.length} files`);
  }

  const manifest = {
    kind: "kmutt-knowledge-bundle",
    version: 1,
    createdAt: new Date().toISOString(),
    sourceHost: host,
    indexName: status?.indexName ?? null,
    namespace: status?.namespace ?? null,
    vectorCount: status?.namespaceRecords ?? null,
    documents: docs.length,
    files: saved.length,
    filesMissing: missing,
  };
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2), "utf-8");

  if (opts.json) {
    console.log(JSON.stringify(manifest, null, 2));
    return 0;
  }

  console.log("");
  console.log(`  ${t.ok(g.ok)} Bundle written to ${t.key(dest)}`);
  console.log(`    ${t.muted(`${docs.length} documents ${g.bullet} ${saved.length} files ${g.bullet} index ${manifest.indexName ?? "?"}/${manifest.namespace ?? "?"}`)}`);
  if (missing.length) {
    console.log("");
    console.log(`  ${t.warn(g.warn)} ${missing.length} source file(s) could not be downloaded:`);
    for (const m of missing.slice(0, 5)) console.log(`    ${t.muted(m)}`);
    console.log(`    ${t.muted("Their entries are still in the registry — search will work, preview will not.")}`);
  }
  console.log("");
  console.log(`  Move the folder to the other machine, then:`);
  console.log(`    ${t.brand(`kmutt import ${path.basename(dest)}`)}`);
  console.log("");
  return 0;
}
