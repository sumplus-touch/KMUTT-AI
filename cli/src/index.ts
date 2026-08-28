#!/usr/bin/env node
/**
 * kmutt — KMUTT rules & knowledge, from the terminal.
 *
 * A thin client over the server's existing /api/knowledge/* routes. Commands
 * are grouped by the job they belong to rather than alphabetically: three
 * verbs a professor uses, four a student officer uses, three an admin uses.
 */
import { Command } from "commander";
import { ask } from "./commands/ask";
import { search } from "./commands/search";
import { ls } from "./commands/ls";
import { doctor } from "./commands/doctor";
import { login } from "./commands/login";
import { add } from "./commands/add";
import { show } from "./commands/show";
import { reindex } from "./commands/reindex";
import { rm } from "./commands/rm";
import { completion } from "./commands/completion";
import { watch } from "./commands/watch";
import { exportBundle } from "./commands/export";
import { importBundle } from "./commands/import";
import { backfillPages } from "./commands/backfill";
import { retitle } from "./commands/retitle";
import { t, g } from "./ui/theme";
import { load, DEFAULT_HOST } from "./config";

const program = new Command();

program
  .name("kmutt")
  .description("KMUTT rules & knowledge, from the terminal")
  .version("0.1.0")
  .option("--json", "machine-readable output (disables colour and spinners)")
  .option("--no-color", "plain text")
  .option("--lang <code>", "message language: en | th (default: system locale)")
  .option("--host <url>", `server URL (default: ${DEFAULT_HOST})`);

/** Commands set an exit code rather than calling process.exit themselves. */
const run = (fn: () => Promise<number>) => async () => {
  process.exitCode = await fn();
};

// ── Ask ──────────────────────────────────────────────────────────────
program
  .command("ask <question...>")
  .description("Answer from the knowledge base, with sources")
  .option("--top-k <n>", "passages to retrieve", "6")
  .option("--category <name>", "restrict to one category")
  .action((words: string[], opts) =>
    run(() => ask(words.join(" "), { ...program.opts(), topK: opts.topK, category: opts.category }))()
  );

program
  .command("search <query...>")
  .description("Show matching passages only — no AI answer")
  .option("--top-k <n>", "passages to retrieve", "8")
  .option("--category <name>", "restrict to one category")
  .action((words: string[], opts) =>
    run(() => search(words.join(" "), { ...program.opts(), topK: opts.topK, category: opts.category }))()
  );

// ── Curate ───────────────────────────────────────────────────────────
program
  .command("add <file>")
  .description("Add a document and index it")
  .option("--title <title>", "document title (prompted if omitted)")
  .option("--category <name>", "regulations | enrollment | financial | research | other")
  .option("--access <who>", "private | shared")
  .action((file: string, opts) =>
    run(() => add(file, { ...program.opts(), title: opts.title, category: opts.category, access: opts.access }))()
  );

program
  .command("show <id>")
  .description("Document detail, status and errors")
  .action((id: string) => run(() => show(id, { ...program.opts() }))());

program
  .command("reindex [id]")
  .description("Re-index after the source changed (adds page numbers)")
  .option("--all", "re-index every document")
  .action((id: string | undefined, opts) => run(() => reindex(id ?? "", { ...program.opts(), all: opts.all }))());

program
  .command("rm <id>")
  .description("Remove a document and its vectors")
  .option("-y, --yes", "skip confirmation")
  .action((id: string, opts) => run(() => rm(id, { ...program.opts(), yes: opts.yes }))());

program
  .command("export [dir]")
  .description("Write registry + source files to a portable bundle")
  .option("--skip-files", "registry only, no document downloads")
  .action((dir: string | undefined, opts) =>
    run(() => exportBundle(dir ?? "./kmutt-bundle", { ...program.opts(), skipFiles: opts.skipFiles }))()
  );

program
  .command("import <dir>")
  .description("Load a bundle onto this server")
  .option("--reindex", "re-embed everything (use when the Pinecone index differs)")
  .option("--replace", "discard the existing registry instead of merging")
  .option("-y, --yes", "skip confirmation")
  .action((dir: string, opts) =>
    run(() => importBundle(dir, { ...program.opts(), reindex: opts.reindex, replace: opts.replace, yes: opts.yes }))()
  );

program
  .command("backfill-pages [id]")
  .description("Add page numbers to existing chunks (no re-embedding)")
  .option("-y, --yes", "skip confirmation")
  .action((id: string | undefined, opts) => run(() => backfillPages(id, { ...program.opts(), yes: opts.yes }))());

program
  .command("retitle <csv>")
  .description("Apply new titles from an edited worksheet (no re-embedding)")
  .option("--dry-run", "show what would change without sending it")
  .option("-y, --yes", "skip confirmation")
  .action((csv: string, opts) =>
    run(() => retitle(csv, { ...program.opts(), yes: opts.yes, dryRun: opts.dryRun }))()
  );

program
  .command("ls")
  .description("List documents")
  .option("--category <name>", "filter by category")
  .action((opts) => run(() => ls({ ...program.opts(), category: opts.category }))());

// ── Operate ──────────────────────────────────────────────────────────
program
  .command("doctor")
  .description("Check connection, index and workspace")
  .action(() => run(() => doctor({ ...program.opts() }))());

program
  .command("watch")
  .description("Ask follow-up questions without restarting")
  .option("--top-k <n>", "passages to retrieve", "6")
  .option("--category <name>", "restrict to one category")
  .action((opts) => run(() => watch({ topK: opts.topK, category: opts.category }))());

program
  .command("completion [shell]")
  .description("Print shell completion (bash | zsh | powershell)")
  .option("--ids", "list document IDs (used by the completion scripts)")
  .action((shell: string | undefined, opts) => run(() => completion(shell ?? "bash", { ids: opts.ids }))());

program
  .command("login")
  .description("Save an access token for this machine")
  .option("--token <token>", "token (otherwise prompts)")
  .option("--host <url>", "server URL")
  .action((opts) => run(() => login({ token: opts.token, host: opts.host }))());

/** Grouped help — each reader finds their row without reading the others. */
program.configureHelp({ formatHelp: () => helpText() });

function helpText(): string {
  const cfg = load();
  return [
    "",
    `  ${t.brand(t.bold("kmutt"))} ${t.muted("— KMUTT rules & knowledge, from the terminal")}`,
    "",
    `  ${t.bold("Ask")}`,
    `    ${t.brand("ask")} <question>       Answer from the knowledge base, with sources`,
    `    ${t.brand("search")} <query>       Show matching passages only — no AI answer`,
    `    ${t.brand("watch")}                Ask follow-up questions without restarting`,
    "",
    `  ${t.bold("Curate")}`,
    `    ${t.brand("add")} <file>           Add a document and index it`,
    `    ${t.brand("ls")}                   List documents`,
    `    ${t.brand("show")} <id>            Document detail, status and errors`,
    `    ${t.brand("reindex")} <id>         Re-index after the source changed`,
    `    ${t.brand("rm")} <id>              Remove a document and its vectors`,
    `    ${t.brand("export")} [dir]          Save registry + files as a portable bundle`,
    `    ${t.brand("import")} <dir>          Load a bundle onto this server`,
    `    ${t.brand("backfill-pages")}       Add page numbers without re-embedding`,
    `    ${t.brand("retitle")} <csv>        Apply new titles from a worksheet`,
    "",
    `  ${t.bold("Operate")}`,
    `    ${t.brand("doctor")}               Check connection, index and workspace`,
    `    ${t.brand("login")}                Save an access token for this machine`,
    `    ${t.brand("completion")} <shell>   Shell tab-completion (bash | zsh | powershell)`,
    "",
    `  ${t.bold("Global flags")}`,
    `    --json               Machine-readable output`,
    `    --category <name>    Restrict to one category`,
    `    --lang th|en         Message language`,
    `    --no-color           Plain text`,
    `    -y, --yes            Skip confirmations`,
    "",
    `  ${t.muted(`Server: ${cfg.host}`)}`,
    "",
    `  Try  ${t.brand('kmutt ask "ยื่นขอลาพักการศึกษาต้องทำอย่างไร"')}`,
    "",
  ].join("\n");
}

if (process.argv.length <= 2) {
  console.log(helpText());
  process.exit(0);
}

program.parseAsync(process.argv).catch((err) => {
  console.error(`${t.stop(g.stop)} ${err.message}`);
  process.exitCode = 1;
});
