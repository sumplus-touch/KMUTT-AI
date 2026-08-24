import { callTigerBot } from "./tigerbot";

/**
 * Generate a short topic name for a chat from its opening prompt.
 *
 * Shared by the socket handler (which names a chat on first send) and the
 * /chat/sessions/:id/title endpoint (manual / retro-titling).
 *
 * Returns null rather than throwing when the model is unavailable or replies
 * with something unusable — callers keep the provisional title instead of
 * writing junk into the sidebar.
 */

const SYSTEM_PROMPT =
  "You name chat conversations. Given the user's opening message, reply with a short topic " +
  "title of 2-6 words that captures the subject. Use the same language as the message " +
  "(Thai stays Thai). Title Case for English. No quotes, no trailing punctuation, no prefix " +
  'like "Topic:" — reply with the title and nothing else.';

/** Model replies that mean "titling did not work". */
const FAILURE_PATTERNS = [
  /^connection error/i,
  /^tigerbot api key/i,
  /api key not configured/i,
  /^no response from/i,
  /^i (cannot|can't|am unable)/i,
  /^sorry[,\s]/i,
];

/**
 * Remove chain-of-thought blocks that reasoning models emit inline.
 *
 * MiniMax-M2, DeepSeek-R1 and friends wrap their reasoning in <think>…</think>
 * inside the normal content field. Without stripping it, the first line of a
 * reply is literally "<think>" — which is exactly what ended up as chat titles.
 * An unterminated opening tag means the whole reply is reasoning, so drop it.
 */
export function stripReasoning(raw: string): string {
  let s = raw || "";
  s = s.replace(/<(think|thinking|reasoning|thought)>[\s\S]*?<\/\1>/gi, "");
  s = s.replace(/<(think|thinking|reasoning|thought)>[\s\S]*$/i, "");
  s = s.replace(/^[\s\S]*?<\/(think|thinking|reasoning|thought)>/i, "");
  return s.trim();
}

/** Strip the decoration models add even when told not to. */
export function cleanTitle(raw: string): string | null {
  let title = stripReasoning(raw).split("\n").map((l) => l.trim()).find((l) => l.length > 0) || "";

  title = title
    .replace(/^\s*(?:topic|title|subject)\s*[:\-–]\s*/i, "")
    .replace(/^[\s"'`*#_]+/, "")
    .replace(/[\s"'`*_]+$/, "")
    .replace(/[.,;:]+$/, "")
    .trim();

  if (!title) return null;
  if (title.length > 80) return null;
  if (FAILURE_PATTERNS.some((re) => re.test(title))) return null;
  return title;
}

export async function generateChatTitle(prompt: string): Promise<string | null> {
  const text = (prompt || "").trim();
  if (!text) return null;

  try {
    // Cap the input: a long opening paste would otherwise cost far more than
    // the title is worth.
    const result = await callTigerBot([{ role: "user", content: text.slice(0, 2000) }], SYSTEM_PROMPT);
    return cleanTitle(result.content || "");
  } catch {
    return null;
  }
}
