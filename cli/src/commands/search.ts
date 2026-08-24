import { api, ApiError } from "../api";
import { spinner } from "../ui/spinner";
import { renderPassages } from "../ui/sources";
import { t, g } from "../ui/theme";
import { printProblem } from "../ui/message";
import { msg as en } from "../i18n";

/** Matching passages only — no AI answer, no token cost. */
export async function search(query: string, opts: { json?: boolean; topK?: string; category?: string }) {
  const topK = Math.min(Math.max(parseInt(opts.topK ?? "8", 10) || 8, 1), 50);
  const sp = spinner(`Searching…`);
  try {
    const res = await api.search(query, topK, opts.category);
    sp.succeed(`Found ${res.count} passage${res.count === 1 ? "" : "s"}`);

    if (opts.json) {
      console.log(JSON.stringify(res, null, 2));
      return 0;
    }
    if (res.count === 0) {
      printProblem(en.NO_MATCH(0));
      return 1;
    }
    console.log("");
    console.log(renderPassages(res.results));
    return 0;
  } catch (err: any) {
    sp.fail("Search failed");
    if (err instanceof ApiError && err.code === "NOT_AUTHENTICATED") printProblem(en.NOT_AUTHENTICATED(api.host()));
    else if (err instanceof ApiError && err.code === "SERVER_UNREACHABLE") printProblem(en.SERVER_UNREACHABLE(api.host()));
    else printProblem(en.KB_NOT_CONNECTED());
    return 1;
  }
}
