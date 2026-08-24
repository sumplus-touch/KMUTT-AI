import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";
import * as XLSX from "xlsx";

/**
 * Read a PDF's text, page by page.
 *
 * pdf-parse v2 dropped the v1 default-export function — `import pdfParse from
 * "pdf-parse"` resolves to undefined and blows up with "(0 ,
 * import_pdf_parse.default) is not a function". v2 exports a PDFParse class
 * instead, and its results must be released with destroy().
 *
 * `pageJoiner: ""` suppresses the default "-- 1 of 12 --" footer that v2
 * appends to every page; those markers would otherwise be embedded into the
 * indexed text and pollute search results.
 */
async function readPdfPages(absPath: string): Promise<{ pages: string[]; total: number }> {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(absPath)) });
  try {
    const result = await parser.getText({ pageJoiner: "" });
    return {
      pages: (result.pages ?? []).map((p) => p.text ?? ""),
      total: result.total ?? result.pages?.length ?? 0,
    };
  } finally {
    await parser.destroy();
  }
}

/** Escape text taken from a document before embedding it in preview HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Document text extraction.
 *
 * Two consumers, one parse path:
 *   - extractPreview()  → rich HTML for the /files/preview panel
 *   - extractText()     → plain text for chunking + knowledge-base indexing
 *
 * Both take an ABSOLUTE path. Sandbox containment (validatePath) stays the
 * caller's responsibility — this module does no authorization.
 */

/** Extensions the preview panel can render as HTML. */
export const PREVIEWABLE_EXTENSIONS = [".pdf", ".doc", ".docx", ".xls", ".xlsx", ".md"];

/** Extensions we can pull plain text out of for indexing. Superset of the above. */
export const INDEXABLE_EXTENSIONS = [
  ...PREVIEWABLE_EXTENSIONS,
  ".txt", ".csv", ".json", ".xml", ".yaml", ".yml",
  ".html", ".css", ".js", ".ts", ".py",
];

export function isPreviewable(filePath: string): boolean {
  return PREVIEWABLE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export function isIndexable(filePath: string): boolean {
  return INDEXABLE_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

export interface PreviewResult {
  type: "pdf" | "docx" | "excel" | "markdown";
  html: string;
  pages?: number;
  sheets?: number;
}

export interface ExtractedText {
  /** Plain text, suitable for chunking and embedding. */
  text: string;
  type: string;
  pages?: number;
  sheets?: number;
  /**
   * Per-page text, when the format has pages (PDF) or sheets (Excel).
   * Lets chunks carry a page number so citations can point at one.
   */
  pageTexts?: string[];
}

/**
 * Render a document to HTML for the preview panel.
 *
 * Output shape is byte-identical to what /files/preview returned before this
 * was factored out of the route.
 */
export async function extractPreview(absPath: string): Promise<PreviewResult> {
  if (!fs.existsSync(absPath)) throw new Error("File not found");
  const ext = path.extname(absPath).toLowerCase();

  if (ext === ".pdf") {
    // v1 split one big string on form feeds; v2 gives real per-page text, so
    // page boundaries are now exact rather than inferred.
    const { pages, total } = await readPdfPages(absPath);
    const html = pages
      .map((page) => page.trim())
      .filter((p) => p.length > 0)
      .map((page) => `<div class="pdf-page">${escapeHtml(page).replace(/\n/g, "<br/>")}</div>`)
      .join('<hr class="page-break"/>');
    return { type: "pdf", pages: total, html };
  }

  if (ext === ".docx" || ext === ".doc") {
    const buffer = fs.readFileSync(absPath);
    const result = await mammoth.convertToHtml({ buffer });
    return { type: "docx", html: result.value };
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const buffer = fs.readFileSync(absPath);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetsHtml: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const html = XLSX.utils.sheet_to_html(sheet, { editable: false });
      sheetsHtml.push(`<h3 style="margin:12px 0 6px;font-size:14px;">${sheetName}</h3>${html}`);
    }
    return { type: "excel", sheets: workbook.SheetNames.length, html: sheetsHtml.join("") };
  }

  if (ext === ".md") {
    const content = fs.readFileSync(absPath, "utf-8");
    return { type: "markdown", html: content };
  }

  throw new Error("Unsupported file type for preview");
}

/**
 * Pull plain text out of a document for indexing.
 *
 * Note for PDFs: pdf-parse reads the embedded text layer only — it does no OCR.
 * A scanned/image-only PDF yields an empty or near-empty string. Callers that
 * index the result should check `text.trim().length` before upserting rather
 * than silently storing an empty document.
 */
export async function extractText(absPath: string): Promise<ExtractedText> {
  if (!fs.existsSync(absPath)) throw new Error("File not found");
  const ext = path.extname(absPath).toLowerCase();

  if (ext === ".pdf") {
    const { pages, total } = await readPdfPages(absPath);
    return { text: pages.join("\n\n").trim(), type: "pdf", pages: total, pageTexts: pages };
  }

  if (ext === ".docx" || ext === ".doc") {
    // extractRawText, not convertToHtml — we want prose, not markup.
    const result = await mammoth.extractRawText({ buffer: fs.readFileSync(absPath) });
    return { text: result.value || "", type: "docx" };
  }

  if (ext === ".xlsx" || ext === ".xls") {
    const workbook = XLSX.read(fs.readFileSync(absPath), { type: "buffer" });
    const parts: string[] = [];
    for (const sheetName of workbook.SheetNames) {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[sheetName]);
      if (csv.trim().length > 0) parts.push(`# ${sheetName}\n${csv}`);
    }
    return { text: parts.join("\n\n"), type: "excel", sheets: workbook.SheetNames.length, pageTexts: parts };
  }

  // Kept explicit so the `type` label matches extractPreview's — it lands in
  // Pinecone metadata and is used for filtering, so the two must agree.
  if (ext === ".md") {
    return { text: fs.readFileSync(absPath, "utf-8"), type: "markdown" };
  }

  // Everything else indexable is already plain text on disk.
  if (INDEXABLE_EXTENSIONS.includes(ext)) {
    return { text: fs.readFileSync(absPath, "utf-8"), type: ext.replace(".", "") };
  }

  throw new Error(`Unsupported file type for text extraction: ${ext}`);
}

export interface Chunk {
  /** 0-based position of this chunk within the source document. */
  index: number;
  text: string;
  /** 1-based page (or sheet) this chunk came from, when known. */
  page?: number;
}

export interface ChunkOptions {
  /**
   * Target chunk size in CHARACTERS (not tokens).
   *
   * Deliberately conservative: multilingual-e5-large caps at ~512 tokens, and
   * Thai tokenizes far denser than English (~2-3 chars/token vs ~4). 800 chars
   * stays under the cap for both. Pinecone's integrated embedding truncates
   * silently past the limit, so erring small costs nothing but a few extra
   * vectors — erring large loses the tail of every chunk.
   */
  size?: number;
  /** Characters of overlap carried between adjacent chunks, to preserve context across cuts. */
  overlap?: number;
}

/** Split points, tried in order — prefer semantic boundaries over hard cuts. */
const SEPARATORS = ["\n\n", "\n", "。", "! ", "? ", ". ", " "];

/**
 * Split text into overlapping chunks, preferring natural boundaries.
 *
 * Walks the text and, for each window, backtracks to the latest separator
 * within the window so chunks end on a paragraph/sentence rather than
 * mid-word. Falls back to a hard cut when no separator is available (common
 * for Thai, which has no inter-word spaces).
 */
export function chunkText(text: string, opts: ChunkOptions = {}): Chunk[] {
  const size = opts.size ?? 800;
  const overlap = opts.overlap ?? 100;

  if (overlap >= size) throw new Error("chunk overlap must be smaller than chunk size");

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= size) return [{ index: 0, text: normalized }];

  const chunks: Chunk[] = [];
  let start = 0;

  while (start < normalized.length) {
    let end = Math.min(start + size, normalized.length);

    // Not at the end of the document — try to land on a natural boundary.
    if (end < normalized.length) {
      // Only backtrack into the last 40% of the window, so a separator found
      // very early doesn't produce a tiny chunk.
      const minEnd = start + Math.floor(size * 0.6);
      for (const sep of SEPARATORS) {
        const found = normalized.lastIndexOf(sep, end);
        if (found > minEnd) {
          end = found + sep.length;
          break;
        }
      }
    }

    const piece = normalized.slice(start, end).trim();
    if (piece.length > 0) chunks.push({ index: chunks.length, text: piece });

    if (end >= normalized.length) break;
    // Step forward, carrying `overlap` characters of context into the next chunk.
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}


/**
 * Chunk a document page by page, tagging each chunk with its page number.
 *
 * Chunking the concatenated text would lose page boundaries, leaving citations
 * unable to say *where* in a 200-page handbook a passage came from. Pages are
 * chunked independently so every chunk maps to exactly one page.
 */
export function chunkPages(pageTexts: string[], opts: ChunkOptions = {}): Chunk[] {
  const chunks: Chunk[] = [];
  pageTexts.forEach((pageText, pageIdx) => {
    for (const c of chunkText(pageText, opts)) {
      chunks.push({ index: chunks.length, text: c.text, page: pageIdx + 1 });
    }
  });
  return chunks;
}
