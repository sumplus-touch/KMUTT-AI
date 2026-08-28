import fs from "fs";
import path from "path";
import { api, ApiError } from "../api";
import { spinner } from "../ui/spinner";
import { confirm } from "../ui/prompt";
import { t, g } from "../ui/theme";
import { truncate } from "../ui/width";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/**
 * Minimal RFC-4180 CSV parser.
 *
 * Written rather than pulled in: the worksheet contains Thai text, quoted
 * fields and embedded commas, and a dependency for one file is not worth it.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  // Strip the BOM that keeps Excel honest about UTF-8.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }   // escaped quote
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/**
 * Apply new titles from the worksheet produced alongside the export.
 *
 * The title is what every citation shows, so this is the highest-leverage
 * metadata to get right — and because it is only metadata, applying it costs
 * no re-embedding.
 */
export async function retitle(csvPath: string, opts: { json?: boolean; yes?: boolean; dryRun?: boolean }) {
  const file = path.resolve(csvPath);
  if (!fs.existsSync(file)) {
    printProblem(en.LOCAL_FILE_NOT_FOUND(csvPath));
    return 1;
  }

  const rows = parseCsv(fs.readFileSync(file, "utf-8"));
  if (rows.length < 2) {
    printProblem({ code: "CSV_EMPTY", title: "That worksheet has no rows", body: "", fix: "" });
    return 1;
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idCol = header.indexOf("id");
  const newCol = header.indexOf("new_title");
  const curCol = header.indexOf("current_title");
  if (idCol === -1 || newCol === -1) {
    printProblem({
      code: "CSV_COLUMNS",
      title: "The worksheet needs an 'id' and a 'NEW_TITLE' column",
      body: `Found: ${header.join(", ")}`,
      fix: "",
    });
    return 1;
  }

  // Only rows whose title actually differs are worth sending.
  const changes: Array<{ id: string; title: string; from: string }> = [];
  let blank = 0;
  for (const r of rows.slice(1)) {
    const id = (r[idCol] ?? "").trim();
    const next = (r[newCol] ?? "").trim();
    const from = curCol >= 0 ? (r[curCol] ?? "").trim() : "";
    if (!id) continue;
    if (!next) { blank++; continue; }
    if (next === from) continue;
    changes.push({ id, title: next, from });
  }

  if (!opts.json) {
    console.log("");
    console.log(`  ${t.brand("kmutt retitle")}  ${t.muted(path.basename(file))}`);
    console.log(`    ${t.muted(`${changes.length} titles to change ${g.bullet} ${blank} rows left blank (skipped)`)}`);
    console.log("");
    for (const c of changes.slice(0, 8)) {
      console.log(`    ${t.muted(truncate(c.from, 30).padEnd(30))} ${t.ref("->")} ${t.key(truncate(c.title, 44))}`);
    }
    if (changes.length > 8) console.log(`    ${t.muted(`… and ${changes.length - 8} more`)}`);
    console.log("");
  }

  if (changes.length === 0) {
    console.log(`  ${t.muted("Nothing to change.")}`);
    console.log("");
    return 0;
  }

  if (opts.dryRun) {
    console.log(`  ${t.muted("--dry-run: nothing was sent.")}`);
    console.log("");
    return 0;
  }

  if (!opts.json && !(await confirm(`Apply ${changes.length} title changes?`, opts.yes))) {
    console.log(`  ${t.muted("Cancelled.")}`);
    return 1;
  }

  const sp = spinner(`Renaming ${changes.length} documents…`);
  try {
    const res: any = await api.retitle(changes.map((c) => ({ id: c.id, title: c.title })));
    sp.succeed(`Renamed ${res.renamed} documents`);

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return res.failed ? 1 : 0;
    }
    console.log("");
    console.log(`  ${t.ok(g.ok)} ${res.renamed} renamed ${t.muted(`${g.bullet} ${res.chunksPatched} chunks updated`)}`);
    if (res.unchanged) console.log(`  ${t.muted(`${res.unchanged} already had that title`)}`);
    if (res.failed) console.log(`  ${t.warn(g.warn)} ${res.failed} failed`);
    if (res.notFound?.length) console.log(`  ${t.warn(g.warn)} unknown ids: ${res.notFound.join(", ")}`);
    console.log("");
    return res.failed ? 1 : 0;
  } catch (err: any) {
    sp.fail("Rename failed");
    if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") printProblem(en.NOT_AUTHENTICATED(api.host()));
    else printProblem({ code: "RETITLE_FAILED", title: "Could not apply the new titles", body: err.message, fix: "kmutt doctor" });
    return 1;
  }
}
