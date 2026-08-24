import { api } from "../api";
import { resolveId } from "./show";
import { confirm, confirmByTyping } from "../ui/prompt";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

export async function rm(id: string, opts: { yes?: boolean; json?: boolean }) {
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
  const shared = d.access === "shared";

  console.log("");
  console.log(`  ${t.warn(g.warn)} Remove ${t.key(`"${d.title}"`)}?`);
  console.log("");
  console.log(`    ${d.chunkCount} chunks will be deleted from the index.`);
  if (shared) console.log(`    ${t.warn("Shared — this removes it for everyone at KMUTT.")}`);
  console.log(`    ${t.muted("The source file stays in your workspace.")}`);
  console.log("");

  // Escalate friction by blast radius, not uniformly.
  const okToGo = shared
    ? await confirmByTyping(d.id.slice(0, 6), d.title, opts.yes)
    : await confirm("Delete it?", opts.yes);

  if (!okToGo) {
    console.log(`  ${t.muted("Cancelled.")}`);
    console.log("");
    return 1;
  }

  const res = await api.remove(d.id);
  console.log("");
  console.log(`  ${t.ok(g.ok)} Removed ${t.key(d.title)}`);
  if (res.warning) console.log(`  ${t.warn(g.warn)} ${res.warning}`);
  console.log("");
  return 0;
}
