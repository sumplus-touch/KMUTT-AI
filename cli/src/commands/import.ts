import fs from "fs";
import path from "path";
import { api, ApiError, KnowledgeDoc } from "../api";
import { load } from "../config";
import { spinner } from "../ui/spinner";
import { confirm } from "../ui/prompt";
import { t, g, interactive } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/**
 * Load a bundle produced by `kmutt export` into this server.
 *
 * Two modes, and the right one depends on where the target's Pinecone points:
 *
 *   default      the target uses the SAME index, so the vectors already exist
 *                under the same document ids. Upload the files and restore the
 *                registry — no re-embedding, no cost, near-instant.
 *
 *   --reindex    the target uses a DIFFERENT (or empty) index. Every document
 *                is uploaded and embedded again.
 */
export async function importBundle(
  bundleDir: string,
  opts: { json?: boolean; reindex?: boolean; yes?: boolean; replace?: boolean }
) {
  const dir = path.resolve(bundleDir);
  const registryPath = path.join(dir, "knowledge.json");
  const filesDir = path.join(dir, "files");

  if (!fs.existsSync(registryPath)) {
    printProblem({
      code: "BUNDLE_NOT_FOUND",
      title: `No bundle at ${bundleDir}`,
      body: "Expected a folder containing knowledge.json, produced by kmutt export.",
      fix: "kmutt export ./kmutt-bundle",
    });
    return 1;
  }

  const docs: KnowledgeDoc[] = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
  let manifest: any = {};
  try { manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf-8")); } catch { /* optional */ }

  // Show what is about to happen — including whether the index matches, which
  // decides whether re-embedding is actually needed.
  let target: any = null;
  try { target = await api.status(); } catch { /* reported below */ }

  const sameIndex =
    manifest.indexName && target?.indexName === manifest.indexName &&
    manifest.namespace && target?.namespace === manifest.namespace;

  if (!opts.json) {
    console.log("");
    console.log(`  ${t.brand("kmutt import")}  ${t.key(path.basename(dir))}`);
    console.log(`    ${t.muted(`${docs.length} documents ${g.bullet} from ${manifest.sourceHost ?? "unknown host"}`)}`);
    console.log(`    ${t.muted(`bundle index : ${manifest.indexName ?? "?"} / ${manifest.namespace ?? "?"}`)}`);
    console.log(`    ${t.muted(`target index : ${target?.indexName ?? "?"} / ${target?.namespace ?? "?"}`)}`);
    console.log("");
    if (opts.reindex) {
      console.log(`  ${t.warn(g.warn)} --reindex: every document will be embedded again (costs Pinecone usage).`);
    } else if (sameIndex) {
      console.log(`  ${t.ok(g.ok)} Same index — vectors already exist, so no re-embedding is needed.`);
    } else {
      console.log(`  ${t.warn(g.warn)} The target points at a different index from the bundle.`);
      console.log(`    ${t.muted("Restoring the registry alone would list documents whose vectors are not there.")}`);
      console.log(`    ${t.muted("Re-run with --reindex to embed them into this index.")}`);
    }
    console.log("");
    if (!(await confirm("Continue?", opts.yes))) {
      console.log(`  ${t.muted("Cancelled.")}`);
      return 1;
    }
  }

  // ── 1. upload the source files so previews and re-index work here too ──
  const { host, token } = load();
  let uploaded = 0;
  const failedUploads: string[] = [];

  if (fs.existsSync(filesDir)) {
    const files = fs.readdirSync(filesDir);
    const sp = spinner(`Uploading ${files.length} files…`);
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      sp.update(`Uploading ${i + 1}/${files.length} ${t.muted(f)}`);
      // Bundle names are "<docId>__<originalName>" — restore the original.
      const original = f.includes("__") ? f.slice(f.indexOf("__") + 2) : f;
      try {
        const form = new FormData();
        form.append("file", new Blob([fs.readFileSync(path.join(filesDir, f))]), original);
        form.append("path", "knowledge");
        const res = await fetch(`${host}/api/files/upload`, {
          method: "POST",
          body: form,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const body: any = await res.json();
        if (!res.ok || body.error) throw new Error(body.error || `HTTP ${res.status}`);
        uploaded++;
      } catch {
        failedUploads.push(original);
      }
    }
    sp.succeed(`Uploaded ${uploaded}/${files.length} files`);
  }

  // ── 2. either restore the registry, or re-index every document ──
  let restored = 0;
  const failedIndex: string[] = [];

  if (opts.reindex) {
    const sp = spinner(`Indexing ${docs.length} documents…`);
    for (let i = 0; i < docs.length; i++) {
      const d = docs[i];
      sp.update(`Indexing ${i + 1}/${docs.length} ${t.muted(d.title.slice(0, 40))}`);
      try {
        await api.addDocument({
          filePath: `knowledge/${d.fileName}`,
          title: d.title,
          description: d.description,
          category: d.category,
          access: d.access,
        });
        restored++;
      } catch (err: any) {
        failedIndex.push(`${d.title}: ${err.message}`);
      }
    }
    sp.succeed(`Indexed ${restored}/${docs.length}`);
  } else {
    const sp = spinner("Restoring registry…");
    try {
      const res: any = await api.restore(docs, opts.replace ? "replace" : "merge");
      restored = res.restored ?? docs.length;
      sp.succeed(`Restored ${restored} documents (${res.total} total)`);
    } catch (err: any) {
      sp.fail("Restore failed");
      if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") printProblem(en.NOT_AUTHENTICATED(api.host()));
      else printProblem({ code: "RESTORE_FAILED", title: "Could not restore the registry", body: err.message, fix: "kmutt doctor" });
      return 1;
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ uploaded, restored, failedUploads, failedIndex }, null, 2));
    return failedIndex.length || failedUploads.length ? 1 : 0;
  }

  console.log("");
  console.log(`  ${t.ok(g.ok)} ${restored} documents now on ${t.key(api.host())}`);
  if (failedUploads.length) console.log(`  ${t.warn(g.warn)} ${failedUploads.length} file(s) failed to upload — preview will not work for those.`);
  for (const f of failedIndex.slice(0, 5)) console.log(`  ${t.stop(g.stop)} ${f}`);
  console.log("");
  console.log(`  ${t.brand("kmutt ls")} ${t.muted("to check")}`);
  console.log("");
  return failedIndex.length ? 1 : 0;
}
