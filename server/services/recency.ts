/**
 * Collapse near-duplicate documents, keeping the newest edition.
 *
 * The KMUTT corpus carries the same form or calendar across many years —
 * "form RO 26Updated", "form RO26 3", "AcademicCalendar2026 2569TH2". A single
 * question can therefore retrieve a dozen editions of one document, which
 * inflates the citation list without adding information and pushes genuinely
 * distinct sources out of the answer.
 *
 * Grouping by document family and keeping only the newest edition means the
 * answer cites "the registration form" once, in its current version.
 */

/** Version words that mark an edition rather than a different document. */
const EDITION_WORDS = /^(updated|update|final|revised|rev|new|copy|draft|v\d*|r|th|en|inter)$/i;

/**
 * 4-digit years, Gregorian or Buddhist era.
 *
 * Lookarounds rather than \b: these names run the year straight onto a word
 * ("discipline2566", "AcademicCalendar2026"), and there is no word boundary
 * between a letter and a digit — \b matched nothing, so no year was ever
 * detected. Digit lookarounds also stop a longer number matching part-way.
 */
const YEAR = /(?<!\d)(19\d{2}|20\d{2}|2[456]\d{2})(?!\d)/g;

/**
 * Normalise a year to a comparable Gregorian value.
 * Buddhist-era years (2400–2699) are 543 ahead of Gregorian.
 */
function toGregorian(year: number): number {
  return year >= 2400 && year <= 2699 ? year - 543 : year;
}

/**
 * Newest year mentioned in a document's title or filename.
 * Returns 0 when the name carries no year at all.
 */
export function editionYear(...names: Array<string | undefined>): number {
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    for (const m of name.matchAll(YEAR)) {
      const g = toGregorian(Number(m[1]));
      // Ignore implausible values so a stray part number cannot win.
      if (g >= 1990 && g <= 2100 && g > best) best = g;
    }
  }
  return best;
}

/**
 * A key shared by every edition of the same document.
 *
 * Years and edition words are dropped, but identifying numbers attached to a
 * word are kept — "RO26" and "RO28" are different forms and must not merge.
 * A trailing standalone number is a copy/part marker and is dropped.
 */
export function familyKey(...names: Array<string | undefined>): string {
  const raw = (names.find(Boolean) || "").toString();
  const withoutExt = raw.replace(/\.[a-z0-9]{1,5}$/i, "");
  // "(1)", "(2)" are copy markers, never the document's identity.
  const noCopies = withoutExt.replace(/\([^)]*\)/g, " ");
  const noYears = noCopies.replace(YEAR, " ");

  const tokens = noYears
    .toLowerCase()
    .split(/[^a-z0-9฀-๿]+/)
    // Drop edition markers, including ones carrying a part number ("TH2" is
    // the same calendar as "TH"). A trailing digit is only stripped for the
    // test, so a document code like "ro26" keeps its number and stays distinct
    // from "ro28".
    .filter((tok) => tok.length > 0 && !EDITION_WORDS.test(tok.replace(/\d+$/, "")));

  // A trailing bare number is a copy marker ONLY when the name already carries
  // its identifying number elsewhere: "form RO26 3" -> "form RO26". Where the
  // trailing number IS the identity — "form RO 25", "2567 B 6708" — it must
  // stay, or every RO form and every programme code collapses into one family.
  const last = tokens[tokens.length - 1];
  const identifiedEarlier = tokens.slice(0, -1).some((tok) => /\d/.test(tok));
  if (tokens.length > 1 && /^\d+$/.test(last) && identifiedEarlier) tokens.pop();

  // Peel edition words that got glued on ("26updated" -> "26").
  const cleaned = tokens.map((tok) =>
    tok.replace(/(updated|update|final|revised|rev|new|draft)$/i, "")
  );

  const key = cleaned.filter(Boolean).join("");
  return key || withoutExt.toLowerCase();
}

export interface RecencyCandidate {
  title?: string;
  fileName?: string;
  score?: number;
  uploadedAt?: string;
  [k: string]: any;
}

/**
 * Keep one hit per document family — the newest edition, and within an
 * edition the best-scoring passage.
 *
 * Order of the surviving hits follows the original relevance ranking, so the
 * most relevant document still leads.
 */
export function keepNewestPerFamily<T extends RecencyCandidate>(hits: T[]): T[] {
  const best = new Map<string, { hit: T; year: number; score: number; order: number }>();

  hits.forEach((hit, order) => {
    const key = familyKey(hit.title, hit.fileName);
    const year = editionYear(hit.title, hit.fileName);
    const score = hit.score ?? 0;
    const seen = best.get(key);

    if (!seen) {
      best.set(key, { hit, year, score, order });
      return;
    }
    // Newer edition wins outright; same edition falls back to the better score.
    const newer = year > seen.year || (year === seen.year && score > seen.score);
    if (newer) best.set(key, { hit, year, score, order: Math.min(order, seen.order) });
  });

  return [...best.values()].sort((a, b) => a.order - b.order).map((x) => x.hit);
}
