/**
 * Message catalogue.
 *
 * Every string lives behind a key from day one — retrofitting i18n across a
 * few hundred inline strings later is a week nobody wants to spend. Each error
 * carries a stable code so one code maps to one help page regardless of the
 * language the reader saw.
 */
export const en = {
  // errors: what happened, why, what to do
  SERVER_UNREACHABLE: (host: string) => ({
    code: "SERVER_UNREACHABLE",
    title: `Cannot reach ${host}`,
    body: "The web app does not appear to be running.",
    fix: "docker compose up -d",
  }),
  NOT_AUTHENTICATED: (host: string) => ({
    code: "NOT_AUTHENTICATED",
    title: `Not signed in to ${host}`,
    body: "This server requires an access token.",
    fix: "kmutt login",
  }),
  KB_NOT_CONNECTED: () => ({
    code: "KB_NOT_CONNECTED",
    title: "Knowledge base is not connected",
    body: "Search and ask need a Pinecone index.",
    fix: "kmutt doctor",
  }),
  NO_MATCH: (n: number) => ({
    code: "NO_MATCH",
    title: "Nothing in the knowledge base matches that",
    body: `${n} documents searched. Try different wording.`,
    fix: "",
  }),
  DOC_NOT_FOUND: (id: string) => ({
    code: "DOC_NOT_FOUND",
    title: `No document with ID ${id}`,
    body: "IDs are the short code in the first column.",
    fix: "kmutt ls",
  }),
  /** A path the user typed on their own machine — not a workspace path. */
  LOCAL_FILE_NOT_FOUND: (p: string) => ({
    code: "LOCAL_FILE_NOT_FOUND",
    title: `No file at ${p}`,
    body: "Checked relative to the directory you ran this from.",
    fix: "",
  }),
  FILE_NOT_FOUND: (p: string) => ({
    code: "FILE_NOT_FOUND",
    title: `No file at ${p}`,
    body: "Paths are relative to the workspace.",
    fix: "kmutt ls",
  }),
  TITLE_REQUIRED: () => ({
    code: "TITLE_REQUIRED",
    title: "Every document needs a title — it is what shows in citations",
    body: "",
    fix: 'kmutt add rules.pdf --title "Academic Regulations 2566"',
  }),
  SCANNED_PDF: (id: string) => ({
    code: "SCANNED_PDF",
    title: "This PDF is a scan, so there is no text to index",
    body: "Its pages are images and there is no OCR step.",
    fix: `Run OCR, then: kmutt reindex ${id}`,
  }),
};

export type Catalogue = typeof en;
