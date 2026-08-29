import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";

const execFileAsync = promisify(execFile);

/**
 * OCR fallback for scanned/image-only PDFs.
 *
 * extract.ts's pdf-parse path reads only the embedded text layer, which a
 * scanned document has none of. This renders each page to a PNG (poppler's
 * pdftoppm) and reads it with Tesseract (tha+eng) — the same two-tool
 * approach the KMUTT_Library OCR brief specified (there: PyMuPDF + pytesseract
 * in Python; here: the equivalent CLI tools shelled out from Node, installed
 * via apk in the Dockerfile so no native npm bindings are needed).
 */

/** Thin old-regulation type needs this to resolve, per the OCR brief. */
const DPI = 350;
const OCR_LANG = "tha+eng";
const PAGE_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 120_000;

export interface OcrResult {
  text: string;
  pageTexts: string[];
}

/**
 * Tesseract's Thai model routinely inserts a space between every character
 * ("ร ะ เบ ี ย บ" instead of "ระเบียบ") — Thai script isn't normally
 * space-segmented at all, so a single space between two Thai characters is
 * always an OCR artifact, never a real word boundary. Collapsing it recovers
 * normal running Thai. Spaces next to a digit or Latin letter are left
 * alone — "พ.ศ. 2539" legitimately has one — and newlines (paragraph/line
 * breaks) are untouched.
 */
function collapseThaiCharSpacing(text: string): string {
  return text.replace(/(?<=[฀-๿])[ \t]+(?=[฀-๿])/g, "");
}

/** True only for "the binary isn't installed" — a non-zero exit for any other reason isn't our call to make here. */
async function isMissing(cmd: string, args: string[]): Promise<boolean> {
  try {
    await execFileAsync(cmd, args, { timeout: 10_000 });
    return false;
  } catch (err: any) {
    return err.code === "ENOENT";
  }
}

export async function ocrAvailable(): Promise<boolean> {
  const [noPdftoppm, noTesseract] = await Promise.all([
    isMissing("pdftoppm", ["-v"]),
    isMissing("tesseract", ["--version"]),
  ]);
  return !noPdftoppm && !noTesseract;
}

/**
 * OCR every page of a PDF. Throws with a clear message if the toolchain is
 * missing or rendering fails outright — callers should catch this and fall
 * back to the (empty) native-extraction result rather than let it bubble up
 * as an unindexable-document error with a misleading message.
 */
export async function ocrPdf(absPath: string): Promise<OcrResult> {
  if (await isMissing("pdftoppm", ["-v"])) {
    throw new Error("pdftoppm (poppler-utils) is not installed on this server — OCR is unavailable.");
  }
  if (await isMissing("tesseract", ["--version"])) {
    throw new Error("tesseract is not installed on this server — OCR is unavailable.");
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "kmutt-ocr-"));
  const prefix = path.join(workDir, "page");
  try {
    await execFileAsync("pdftoppm", ["-png", "-r", String(DPI), absPath, prefix], { timeout: RENDER_TIMEOUT_MS });

    const pages = fs
      .readdirSync(workDir)
      .filter((f) => f.endsWith(".png"))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    if (pages.length === 0) {
      throw new Error("Rendering produced no page images — the PDF may be corrupt or empty.");
    }

    const pageTexts: string[] = [];
    for (const file of pages) {
      const imgPath = path.join(workDir, file);
      const { stdout } = await execFileAsync(
        "tesseract",
        [imgPath, "stdout", "-l", OCR_LANG, "--psm", "6"],
        { timeout: PAGE_TIMEOUT_MS, maxBuffer: 20 * 1024 * 1024 }
      );
      pageTexts.push(collapseThaiCharSpacing(stdout.trim()));
    }

    return { text: pageTexts.join("\n\n").trim(), pageTexts };
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}
