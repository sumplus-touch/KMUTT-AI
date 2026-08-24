import fs from "fs";
import path from "path";
import { api, ApiError } from "../api";
import { load } from "../config";
import { text, select } from "../ui/prompt";
import { spinner } from "../ui/spinner";
import { t, g, interactive } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

const CATEGORIES = [
  { value: "regulations", label: "regulations", hint: "Rules, announcements, discipline" },
  { value: "enrollment", label: "enrollment", hint: "Registration, exams, calendars" },
  { value: "financial", label: "financial", hint: "Fees, scholarships, reimbursement" },
  { value: "research", label: "research", hint: "Thesis, defence, graduate study" },
  { value: "other", label: "other", hint: "Forms, manuals, everything else" },
];

/**
 * Add a document and index it.
 *
 * Uploads through /api/files/upload (multipart) and then registers it, which
 * is exactly what the web app does — so a file added here behaves identically
 * to one added by clicking.
 */
export async function add(
  filePath: string,
  opts: { title?: string; category?: string; access?: string; yes?: boolean; json?: boolean }
) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    printProblem(en.LOCAL_FILE_NOT_FOUND(filePath));
    return 1;
  }

  const stat = fs.statSync(abs);
  const base = path.basename(abs);

  if (!opts.json && interactive) {
    console.log("");
    console.log(`  ${t.brand("kmutt add")}  ${t.key(base)} ${t.muted(`${g.bullet} ${(stat.size / 1024 / 1024).toFixed(1)} MB`)}`);
    console.log(`  ${t.muted(g.rail)}`);
  }

  // Every document needs a title — it is what shows in citations.
  let title = opts.title ?? "";
  if (!title) {
    if (!interactive) {
      printProblem(en.TITLE_REQUIRED());
      return 1;
    }
    title = await text("Title", base.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
  }

  const category = opts.category ?? (interactive ? await select("Category", CATEGORIES) : "other");
  const access = opts.access ?? (interactive ? await select("Who can see it?", [
    { value: "private", label: "private", hint: "Only you" },
    { value: "shared", label: "shared", hint: "Everyone at KMUTT" },
  ]) : "private");

  // ── upload ──
  const sp = spinner("Uploading…");
  let uploadedPath = "";
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(abs)]), base);
    form.append("path", "knowledge");

    const { host, token } = load();
    const res = await fetch(`${host}/api/files/upload`, {
      method: "POST",
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    const body: any = await res.json();
    if (!res.ok || body.error) throw new Error(body.error || `upload failed (${res.status})`);
    uploadedPath = body.path;
    sp.update("Extracting and indexing…");
  } catch (err: any) {
    sp.fail("Upload failed");
    printProblem({ code: "UPLOAD_FAILED", title: "Could not upload the file", body: err.message, fix: "kmutt doctor" });
    return 1;
  }

  // ── index ──
  try {
    const res = await api.addDocument({ filePath: uploadedPath, title, category, access });
    sp.succeed(`Indexed ${t.key(title)}`);

    if (opts.json) {
      console.log(JSON.stringify(res.document, null, 2));
      return 0;
    }
    console.log("");
    console.log(`  ${t.ok(g.ok)} ${res.document.chunkCount} passages indexed`);
    console.log(`  ${t.muted(`ID ${res.document.id.slice(0, 6)}`)}`);
    console.log("");
    return 0;
  } catch (err: any) {
    sp.fail("Indexing failed");
    // A scan is by far the most common cause — name it specifically.
    if (/scan|no text/i.test(err.message)) printProblem(en.SCANNED_PDF(base));
    else if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") printProblem(en.NOT_AUTHENTICATED(api.host()));
    else printProblem({ code: "INDEX_FAILED", title: "Could not index the document", body: err.message, fix: "kmutt doctor" });
    return 1;
  }
}
