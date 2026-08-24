import { api, ApiError } from "../api";
import { load, configPath } from "../config";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/**
 * Diagnose everything at once, then expand only the failure into a fix.
 *
 * Replaces the old single-line "not configured" error that named a Settings
 * screen a terminal user cannot see.
 */
export async function doctor(opts: { json?: boolean }) {
  const cfg = load();
  const checks: Array<{ label: string; ok: boolean; detail: string }> = [];
  let failure: ReturnType<typeof en.KB_NOT_CONNECTED> | null = null;

  // 1. server reachable
  let settings: Record<string, any> | null = null;
  try {
    settings = await api.settings();
    checks.push({ label: "Server", ok: true, detail: cfg.host });
  } catch (err: any) {
    checks.push({ label: "Server", ok: false, detail: cfg.host });
    if (err.code === "NOT_AUTHENTICATED") {
      checks.push({ label: "Access token", ok: false, detail: "invalid or missing" });
      failure = en.NOT_AUTHENTICATED(cfg.host);
    } else {
      failure = en.SERVER_UNREACHABLE(cfg.host);
    }
  }

  if (settings) {
    checks.push({ label: "Access token", ok: true, detail: cfg.token ? "saved" : "not required" });

    // 2. knowledge base
    try {
      const st = await api.status();
      if (st.ready) {
        checks.push({
          label: "Knowledge base",
          ok: true,
          detail: `${st.indexName} ${g.bullet} ${st.namespaceRecords ?? 0} chunks`,
        });
      } else {
        checks.push({ label: "Knowledge base", ok: false, detail: st.error || "not connected" });
        failure = failure ?? en.KB_NOT_CONNECTED();
      }
    } catch {
      checks.push({ label: "Knowledge base", ok: false, detail: "not connected" });
      failure = failure ?? en.KB_NOT_CONNECTED();
    }

    // 3. documents
    try {
      const docs = await api.documents();
      const bad = docs.filter((d) => d.status === "failed" || d.fileMissing).length;
      checks.push({
        label: "Documents",
        ok: bad === 0,
        detail: bad === 0 ? `${docs.length} indexed` : `${docs.length} total ${g.bullet} ${bad} need attention`,
      });
    } catch { /* covered by the checks above */ }
  }

  if (opts.json) {
    console.log(JSON.stringify({ host: cfg.host, config: configPath(), checks }, null, 2));
    return failure ? 1 : 0;
  }

  console.log("");
  const width = Math.max(...checks.map((c) => c.label.length));
  for (const c of checks) {
    const mark = c.ok ? t.ok(g.ok) : t.stop(g.stop);
    console.log(`  ${mark} ${c.label.padEnd(width + 2)} ${t.muted(c.detail)}`);
  }
  console.log("");

  if (failure) printProblem(failure);
  return failure ? 1 : 0;
}
