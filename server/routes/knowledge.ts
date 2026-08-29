import { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";
import { validatePath } from "../services/sandbox";
import { ocrAvailable } from "../services/ocr";
import { extractText, chunkText, chunkPages, mapLegacyChunksToPages, isIndexable, INDEXABLE_EXTENSIONS } from "../services/extract";
import {
  upsertDocument,
  deleteDocumentVectors,
  searchKnowledge,
  ensureIndex,
  getIndexStats,
  isKnowledgeBaseReady,
  updateChunkMetadata,
  chunkId,
  ChunkMetadata,
} from "../services/pinecone";
import { getKnowledgeDocs, saveKnowledgeDocs, KnowledgeDoc } from "../services/data";

/**
 * A document whose extracted text is shorter than this is treated as a failed
 * extraction rather than indexed. extractText() already tries OCR on a PDF
 * with an empty text layer (see extract.ts); this only fires when that also
 * came up empty — e.g. OCR isn't installed, or the scan is unreadable — and
 * we would otherwise store a document the model can never retrieve anything
 * useful from.
 */
const MIN_EXTRACTABLE_CHARS = 20;

const KB_SUBDIR = "knowledge";

/** Index (or re-index) one registry entry. Mutates and returns the doc. */
async function indexDocument(doc: KnowledgeDoc, absPath: string): Promise<KnowledgeDoc> {
  const previousChunkCount = doc.chunkCount;
  try {
    const extracted = await extractText(absPath);

    if (extracted.text.trim().length < MIN_EXTRACTABLE_CHARS) {
      doc.status = "failed";
      doc.error =
        extracted.type === "pdf"
          ? "No text could be extracted. This looks like a scanned PDF, and OCR could not recover usable text either — it cannot be indexed."
          : "No text could be extracted from this file.";
      doc.chunkCount = 0;
      // Drop anything a previous successful index left behind.
      if (previousChunkCount > 0) {
        await deleteDocumentVectors(doc.id, previousChunkCount).catch(() => {});
      }
      return doc;
    }

    // Chunk per page when the format has pages, so every chunk can cite one.
    const chunks = extracted.pageTexts && extracted.pageTexts.length > 0
      ? chunkPages(extracted.pageTexts)
      : chunkText(extracted.text);
    const metadata: ChunkMetadata = {
      docId: doc.id,
      title: doc.title,
      category: doc.category,
      fileName: doc.fileName,
      fileType: extracted.type,
      access: doc.access,
      uploadedAt: doc.uploadedAt,
      ocr: Boolean(extracted.ocr),
    };

    await upsertDocument(doc.id, chunks, metadata, previousChunkCount);

    doc.fileType = extracted.type;
    doc.chunkCount = chunks.length;
    doc.status = "indexed";
    doc.indexedAt = new Date().toISOString();
    doc.ocr = Boolean(extracted.ocr);
    delete doc.error;
  } catch (err: any) {
    doc.status = "failed";
    doc.error = err.message;
  }
  return doc;
}

export async function knowledgeRoutes(fastify: FastifyInstance) {
  // NOTE: @fastify/multipart is registered by filesRoutes in its own plugin
  // scope, so it is NOT available here. This route reads the already-uploaded
  // file from the sandbox instead of accepting a multipart body — the client
  // uploads via /api/files/upload first, then calls POST /documents.

  /** Configuration + index health. */
  fastify.get("/status", async () => {
    const ready = await isKnowledgeBaseReady();
    const ocr = await ocrAvailable().catch(() => false);
    if (!ready) {
      return { ready: false, configured: false, error: "Knowledge base disabled or Pinecone API key missing", ocrAvailable: ocr };
    }
    const stats = await getIndexStats();
    return { ready: stats.ok, configured: true, ocrAvailable: ocr, ...stats };
  });

  /** Create the Pinecone index. Idempotent. */
  fastify.post("/index/create", async (request, reply) => {
    try {
      const result = await ensureIndex();
      return { success: true, ...result };
    } catch (err: any) {
      reply.code(500);
      return { error: err.message };
    }
  });

  /**
   * List registry entries, newest first.
   *
   * Each entry carries `fileMissing` — the vectors can outlive the source
   * file (a Docker rebuild that mounts a fresh volume over the knowledge
   * directory will do exactly that). Search still works in that state, but
   * preview and re-index cannot, so the UI needs to say so plainly instead of
   * failing with a raw 404.
   */
  fastify.get("/documents", async (request) => {
    const docs = await getKnowledgeDocs();
    return docs
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .map((d) => {
        let fileMissing = true;
        try {
          fileMissing = !fs.existsSync(validatePath(request.server.sandboxDir, d.filePath));
        } catch {
          // path escaped the sandbox — treat as missing
        }
        return { ...d, fileMissing };
      });
  });

  /**
   * Register a sandbox file as a knowledge-base document and index it.
   * Body: { filePath, title, description?, category?, access? }
   */
  fastify.post("/documents", async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const { filePath, title } = body;

    if (!filePath) { reply.code(400); return { error: "filePath required" }; }
    if (!title || !String(title).trim()) {
      reply.code(400);
      return {
        error: "Every document needs a title — it is what shows in citations.",
        code: "TITLE_REQUIRED",
      };
    }

    if (!(await isKnowledgeBaseReady())) {
      reply.code(503);
      return {
        error: "Knowledge base is not connected. Search needs a Pinecone index — check what is missing with: kmutt doctor",
        code: "KB_NOT_CONNECTED",
      };
    }

    let absPath: string;
    try {
      absPath = validatePath(request.server.sandboxDir, filePath);
    } catch (err: any) {
      reply.code(403);
      return { error: err.message };
    }
    if (!fs.existsSync(absPath)) {
      reply.code(404);
      return {
        error: `No file at "${filePath}". Paths are relative to the workspace.`,
        code: "FILE_NOT_FOUND",
      };
    }
    if (!isIndexable(absPath)) {
      reply.code(400);
      return {
        error: `"${path.extname(absPath)}" files cannot be indexed. Supported: ${INDEXABLE_EXTENSIONS.join(", ")}. Export to PDF and try again.`,
        code: "FILE_UNSUPPORTED",
      };
    }

    const access = body.access === "shared" ? "shared" : "private";
    const doc: KnowledgeDoc = {
      id: uuid(),
      title: String(title).trim(),
      description: String(body.description ?? "").trim(),
      category: String(body.category ?? "other").trim(),
      access,
      fileName: path.basename(absPath),
      filePath,
      fileType: path.extname(absPath).replace(".", "").toLowerCase(),
      fileSize: fs.statSync(absPath).size,
      chunkCount: 0,
      status: "processing",
      uploadedAt: new Date().toISOString(),
    };

    await indexDocument(doc, absPath);

    const docs = await getKnowledgeDocs();
    docs.push(doc);
    await saveKnowledgeDocs(docs);

    if (doc.status === "failed") { reply.code(422); return { error: doc.error, document: doc }; }
    return { success: true, document: doc };
  });

  /**
   * Extract every supported file from an uploaded .zip into the knowledge
   * directory — extraction only, nothing is registered or indexed here.
   *
   * A bulk upload (many PDFs at once) reuses the exact same POST /documents
   * call this route's single-file sibling uses, once per extracted file —
   * so the indexing logic that matters (chunking, embedding, failure
   * handling) lives in exactly one place, not two.
   *
   * Body: { filePath } — the zip's own sandbox-relative path, from the
   * generic POST /files/upload the client already calls for single files.
   */
  fastify.post("/extract-zip", async (request, reply) => {
    const { filePath } = (request.body ?? {}) as any;
    if (!filePath) { reply.code(400); return { error: "filePath required" }; }

    let zipAbsPath: string;
    try {
      zipAbsPath = validatePath(request.server.sandboxDir, filePath);
    } catch (err: any) {
      reply.code(403);
      return { error: err.message };
    }
    if (!fs.existsSync(zipAbsPath)) {
      reply.code(404);
      return { error: `No file at "${filePath}".` };
    }
    if (path.extname(zipAbsPath).toLowerCase() !== ".zip") {
      reply.code(400);
      return { error: "Not a .zip file." };
    }

    let entries;
    try {
      entries = new AdmZip(zipAbsPath).getEntries();
    } catch (err: any) {
      reply.code(400);
      return { error: `Could not read the zip file: ${err.message}` };
    }

    const destDir = path.join(request.server.sandboxDir, KB_SUBDIR);
    fs.mkdirSync(destDir, { recursive: true });

    const extracted: Array<{ fileName: string; filePath: string; fileSize: number }> = [];
    const skipped: Array<{ fileName: string; reason: string }> = [];

    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const base = path.basename(entry.entryName);
      // Zip metadata cruft (macOS resource forks, dotfiles) — never a document.
      if (!base || base.startsWith(".") || entry.entryName.includes("__MACOSX/")) continue;

      if (!INDEXABLE_EXTENSIONS.includes(path.extname(base).toLowerCase())) {
        skipped.push({ fileName: base, reason: "unsupported file type" });
        continue;
      }

      // Dedupe against files already on disk and earlier entries in this zip.
      let target = base;
      let n = 1;
      const ext = path.extname(base);
      const stem = path.basename(base, ext);
      while (
        fs.existsSync(path.join(destDir, target)) ||
        extracted.some((e) => e.fileName === target)
      ) {
        target = `${stem}-${++n}${ext}`;
      }

      try {
        const data = entry.getData();
        fs.writeFileSync(path.join(destDir, target), data);
        extracted.push({ fileName: target, filePath: `${KB_SUBDIR}/${target}`, fileSize: data.length });
      } catch (err: any) {
        skipped.push({ fileName: base, reason: err.message || "extraction failed" });
      }
    }

    // The zip was only a staging file — its contents now live in the
    // knowledge directory as ordinary files.
    try { fs.unlinkSync(zipAbsPath); } catch { /* best-effort cleanup */ }

    return { success: true, extracted, skipped };
  });

  /**
   * Restore a document registry exported from another machine.
   *
   * The registry lives in data/knowledge.json inside a Docker volume, while
   * the vectors live in Pinecone. Move a deployment and only the vectors
   * follow — the new server shows 0 documents while the chunk count is intact,
   * because the list and the count read from different places.
   *
   * Restoring the registry alone is enough when the target points at the SAME
   * Pinecone index: the vectors are already there under the same document ids,
   * so nothing needs re-embedding. Pointing at a fresh index means the client
   * should re-index instead (kmutt import --reindex).
   *
   * Body: { documents: KnowledgeDoc[], mode?: "merge" | "replace" }
   */
  fastify.post("/restore", async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const incoming = body.documents;
    if (!Array.isArray(incoming)) {
      reply.code(400);
      return { error: "documents must be an array", code: "BAD_RESTORE_PAYLOAD" };
    }

    // Only accept entries that carry the fields the UI depends on.
    const valid: KnowledgeDoc[] = [];
    const rejected: string[] = [];
    for (const d of incoming) {
      if (d && typeof d.id === "string" && typeof d.title === "string" && typeof d.filePath === "string") {
        valid.push({
          id: d.id,
          title: d.title,
          description: String(d.description ?? ""),
          category: String(d.category ?? "other"),
          access: d.access === "shared" ? "shared" : "private",
          fileName: String(d.fileName ?? ""),
          filePath: d.filePath,
          fileType: String(d.fileType ?? ""),
          fileSize: Number(d.fileSize ?? 0),
          chunkCount: Number(d.chunkCount ?? 0),
          status: d.status === "failed" || d.status === "processing" ? d.status : "indexed",
          ...(d.error ? { error: String(d.error) } : {}),
          uploadedAt: String(d.uploadedAt ?? new Date().toISOString()),
          ...(d.indexedAt ? { indexedAt: String(d.indexedAt) } : {}),
        });
      } else {
        rejected.push(String(d?.title ?? d?.id ?? "unknown"));
      }
    }

    const mode = body.mode === "replace" ? "replace" : "merge";
    const existing = mode === "replace" ? [] : await getKnowledgeDocs();

    // Merge on id so re-running a restore is idempotent rather than duplicating.
    const byId = new Map(existing.map((d) => [d.id, d]));
    for (const d of valid) byId.set(d.id, d);
    const merged = [...byId.values()];

    await saveKnowledgeDocs(merged);
    return { success: true, restored: valid.length, rejected: rejected.length, total: merged.length, mode };
  });

  /**
   * Rename documents.
   *
   * The title is what appears in every citation, so a poor one ("staff QA004")
   * degrades the answer even though the retrieved text is fine. Titles live in
   * two places — the registry, and the `title` metadata carried on every chunk
   * — and both must move together or the reference box and the document list
   * disagree.
   *
   * Metadata-only patch: nothing is re-embedded and no vector is recreated, so
   * renaming 289 documents costs no Pinecone usage.
   *
   * Body: { titles: [{ id, title }, ...] }
   */
  fastify.post("/retitle", async (request, reply) => {
    const list = (request.body as any)?.titles;
    if (!Array.isArray(list) || list.length === 0) {
      reply.code(400);
      return { error: "titles must be a non-empty array of { id, title }", code: "BAD_RETITLE_PAYLOAD" };
    }
    if (!(await isKnowledgeBaseReady())) {
      reply.code(503);
      return { error: "Knowledge base is not connected.", code: "KB_NOT_CONNECTED" };
    }

    const docs = await getKnowledgeDocs();
    const byId = new Map(docs.map((d) => [d.id, d]));

    let renamed = 0, chunksPatched = 0, failed = 0, unchanged = 0;
    const notFound: string[] = [];

    for (const entry of list) {
      const id = String(entry?.id ?? "");
      const title = String(entry?.title ?? "").trim();
      if (!id || !title) { failed++; continue; }

      const doc = byId.get(id);
      if (!doc) { notFound.push(id); continue; }
      if (doc.title === title) { unchanged++; continue; }

      doc.title = title;
      renamed++;

      // Every chunk of this document carries the title, so all of them move.
      if (doc.chunkCount > 0) {
        const updates = Array.from({ length: doc.chunkCount }, (_, i) => ({
          id: chunkId(doc.id, i),
          metadata: { title },
        }));
        const res = await updateChunkMetadata(updates);
        chunksPatched += res.updated;
        failed += res.failed;
      }
    }

    // Written once at the end so a mid-run failure cannot leave the registry
    // disagreeing with what was already patched into the index.
    await saveKnowledgeDocs(docs);

    return { success: true, renamed, unchanged, chunksPatched, failed, notFound: notFound.slice(0, 10) };
  });

  /**
   * Add page numbers to documents indexed before page tracking existed.
   *
   * Patches metadata on the EXISTING vectors rather than re-indexing, so
   * nothing is re-embedded and there is no Pinecone usage cost. The chunk text
   * is untouched — only a `page` field is added.
   *
   * Body: { id?: string }  — one document, or all of them when omitted.
   */
  fastify.post("/backfill-pages", async (request, reply) => {
    if (!(await isKnowledgeBaseReady())) {
      reply.code(503);
      return { error: "Knowledge base is not connected.", code: "KB_NOT_CONNECTED" };
    }

    const only = (request.body as any)?.id as string | undefined;
    const docs = (await getKnowledgeDocs()).filter((d) => (only ? d.id === only : true));
    if (docs.length === 0) {
      reply.code(404);
      return { error: only ? `No document with id ${only}` : "No documents to process", code: "DOC_NOT_FOUND" };
    }

    let patched = 0, failed = 0, skipped = 0;
    const problems: Array<{ title: string; why: string }> = [];

    for (const doc of docs) {
      try {
        const abs = validatePath(request.server.sandboxDir, doc.filePath);
        if (!fs.existsSync(abs)) { skipped++; problems.push({ title: doc.title, why: "source file missing" }); continue; }

        const extracted = await extractText(abs);
        // Only paged formats can carry a page number at all.
        if (!extracted.pageTexts || extracted.pageTexts.length === 0) { skipped++; continue; }

        // Reproduce the ORIGINAL chunk boundaries so each id still refers to
        // the same text, then map each one back to the page it came from.
        const mapping = mapLegacyChunksToPages(extracted.pageTexts);
        const updates = mapping
          .filter((m) => m.index < doc.chunkCount)
          .map((m) => ({ id: chunkId(doc.id, m.index), metadata: { page: m.page } }));

        if (updates.length === 0) { skipped++; continue; }
        const res = await updateChunkMetadata(updates);
        patched += res.updated;
        failed += res.failed;
      } catch (err: any) {
        failed++;
        problems.push({ title: doc.title, why: err.message });
      }
    }

    return { success: true, documents: docs.length, chunksPatched: patched, failed, skipped, problems: problems.slice(0, 10) };
  });

  /** Re-index an existing document (e.g. after the underlying file changed). */
  fastify.post("/documents/:id/reindex", async (request, reply) => {
    const id = (request.params as any).id;
    const docs = await getKnowledgeDocs();
    const doc = docs.find((d) => d.id === id);
    if (!doc) { reply.code(404); return { error: "Document not found" }; }

    if (!(await isKnowledgeBaseReady())) {
      reply.code(503);
      return { error: "Knowledge base is not configured." };
    }

    let absPath: string;
    try {
      absPath = validatePath(request.server.sandboxDir, doc.filePath);
    } catch (err: any) {
      reply.code(403);
      return { error: err.message };
    }
    if (!fs.existsSync(absPath)) {
      doc.status = "failed";
      doc.error = "Source file is no longer in the workspace";
      await saveKnowledgeDocs(docs);
      reply.code(404);
      return { error: doc.error, document: doc };
    }

    await indexDocument(doc, absPath);
    await saveKnowledgeDocs(docs);

    if (doc.status === "failed") { reply.code(422); return { error: doc.error, document: doc }; }
    return { success: true, document: doc };
  });

  /**
   * Delete a document: its vectors, its registry entry, and — only if the file
   * lives in the knowledge/ subdirectory we own — the file itself. Files the
   * user registered from elsewhere in the workspace are left alone.
   */
  fastify.delete("/documents/:id", async (request, reply) => {
    const id = (request.params as any).id;
    const docs = await getKnowledgeDocs();
    const doc = docs.find((d) => d.id === id);
    if (!doc) { reply.code(404); return { error: "Document not found" }; }

    let vectorError: string | undefined;
    if (doc.chunkCount > 0) {
      try {
        await deleteDocumentVectors(doc.id, doc.chunkCount);
      } catch (err: any) {
        // Registry entry still gets removed — otherwise a Pinecone outage would
        // make the document permanently undeletable from the UI.
        vectorError = err.message;
      }
    }

    if (doc.filePath.startsWith(KB_SUBDIR + "/")) {
      try {
        const abs = validatePath(request.server.sandboxDir, doc.filePath);
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        // Leaving an orphaned file is preferable to failing the delete.
      }
    }

    await saveKnowledgeDocs(docs.filter((d) => d.id !== id));
    return vectorError
      ? { success: true, warning: `Registry entry removed, but vector cleanup failed: ${vectorError}` }
      : { success: true };
  });

  /** Semantic search. Body: { query, topK?, category? } */
  fastify.post("/search", async (request, reply) => {
    const body = (request.body ?? {}) as any;
    const query = body.query;
    if (!query || !String(query).trim()) { reply.code(400); return { error: "query required" }; }

    if (!(await isKnowledgeBaseReady())) {
      reply.code(503);
      return { error: "Knowledge base is not configured." };
    }

    const topK = Math.min(Math.max(Number(body.topK) || 10, 1), 50);
    const filter = body.category ? { category: { $eq: String(body.category) } } : undefined;

    try {
      const hits = await searchKnowledge(String(query), topK, filter);
      return { query, count: hits.length, results: hits };
    } catch (err: any) {
      reply.code(500);
      return { error: err.message };
    }
  });
}
