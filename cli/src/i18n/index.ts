import { en, Catalogue } from "./en";
import { th } from "./th";
import { load } from "../config";

/**
 * Language selection: --lang flag, then saved config, then the system locale.
 * Defaults to English so an unset locale never produces half-translated output.
 */
function pickLang(): "en" | "th" {
  const flagIdx = process.argv.indexOf("--lang");
  const flag = flagIdx >= 0 ? process.argv[flagIdx + 1] : undefined;
  const configured = load().lang;
  const sys = (process.env.LC_ALL || process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || "")
    .toLowerCase();
  const chosen = flag || configured || (sys.startsWith("th") ? "th" : "en");
  return chosen === "th" ? "th" : "en";
}

export const msg: Catalogue = pickLang() === "th" ? th : en;
export const lang = pickLang();
