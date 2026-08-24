import { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import path from "path";
import fs from "fs";
import { validatePath } from "../services/sandbox";
import { extractText, chunkText, chunkPages, isIndexable, INDEXABLE_EXTENSIONS } from "../services/extract";
import {
  upsertDocument,
  deleteDocumentVectors,
  searchKnowledge,
  ensureIndex,
  getIndexStats,
  isKnowledgeBaseReady,
  ChunkMetadata,
} from "../services/pinecone";
import { getKnowledgeDocs, saveKnowledgeDocs, KnowledgeDoc } from "../services/data";

/**
 * A document whose extracted text is shorter than this is treated as a failed
 * extraction rather than indexed. The usual cause is a scanned/image-only PDF:
 * pdf-parse has no OCR, so it returns an empty string and we would otherwise
 * store a document the model can never retrieve anything useful from.
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
          ? "No text could be extracted. This looks like a scanned PDF — text-layer extraction has no OCR, so it cannot be indexed."
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
    };

    await upsertDocument(doc.id, chunks, metadata, previousChunkCount);

    doc.fileType = extracted.type;
    doc.chunkCount = chunks.length;
    doc.status = "indexed";
    doc.indexedAt = new Date().toISOString();
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
    if (!ready) {
      return { ready: false, configured: false, error: "Knowledge base disabled or Pinecone API key missing" };
    }
    const stats = await getIndexStats();
    return { ready: stats.ok, configured: true, ...stats };
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
