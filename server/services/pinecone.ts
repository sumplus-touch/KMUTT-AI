import { Pinecone } from "@pinecone-database/pinecone";
import { getSettings } from "./data";
import type { Chunk } from "./extract";

/**
 * Pinecone knowledge base — integrated embedding.
 *
 * The index is created with `createIndexForModel`, so Pinecone runs the
 * embedding model server-side: we send and receive TEXT, never vectors. That
 * keeps the backend free of any embedding dependency.
 *
 * Everything here is inert until both a key and an index name are configured
 * (settings.json, or PINECONE_API_KEY in the environment). Callers should
 * gate on `isKnowledgeBaseReady()` rather than catching connection errors.
 */

/** Field that Pinecone embeds — must match the index's `fieldMap.text`. */
export const TEXT_FIELD = "chunk_text";

/** Default embedding model. Thai + English content rules out English-only models. */
export const DEFAULT_MODEL = "multilingual-e5-large";

export const DEFAULT_INDEX_NAME = "kmutt-knowledge-base";
export const DEFAULT_NAMESPACE = "kmutt-kb";

/**
 * Records per upsertRecords call. Pinecone caps request payload size rather
 * than record count; 96 chunks of ~800 chars stays well inside that.
 */
const UPSERT_BATCH_SIZE = 96;

/** IDs per delete call. */
const DELETE_BATCH_SIZE = 500;

export interface PineconeConfig {
  apiKey: string;
  indexName: string;
  namespace: string;
  cloud: string;
  region: string;
  model: string;
}

export interface KnowledgeHit {
  id: string;
  score: number;
  text: string;
  docId?: string;
  title?: string;
  category?: string;
  fileName?: string;
  chunkIndex?: number;
  /** 1-based page/sheet the passage came from, when the format has pages. */
  page?: number;
}

/** Metadata carried on every chunk. Kept flat — Pinecone allows only scalars and string lists. */
export interface ChunkMetadata {
  docId: string;
  title: string;
  category: string;
  fileName: string;
  fileType: string;
  access: string;
  uploadedAt: string;
}

export async function getPineconeConfig(): Promise<PineconeConfig> {
  const s = await getSettings();
  return {
    // Settings win over env so the key can be rotated from the UI without a restart.
    apiKey: s.pineconeApiKey || process.env.PINECONE_API_KEY || "",
    indexName: s.pineconeIndexName || DEFAULT_INDEX_NAME,
    namespace: s.pineconeNamespace || DEFAULT_NAMESPACE,
    cloud: s.pineconeCloud || "aws",
    region: s.pineconeRegion || "us-east-1",
    model: s.pineconeModel || DEFAULT_MODEL,
  };
}

/** True when the knowledge base is both configured and switched on. */
export async function isKnowledgeBaseReady(): Promise<boolean> {
  const s = await getSettings();
  if (!s.knowledgeBaseEnabled) return false;
  const cfg = await getPineconeConfig();
  return Boolean(cfg.apiKey && cfg.indexName);
}

// Cached client, invalidated when the API key changes.
let cachedClient: Pinecone | null = null;
let cachedKey = "";

function getClient(cfg: PineconeConfig): Pinecone {
  if (!cfg.apiKey) {
    throw new Error("Pinecone is not configured — set pineconeApiKey in Settings or PINECONE_API_KEY in .env");
  }
  if (!cachedClient || cachedKey !== cfg.apiKey) {
    cachedClient = new Pinecone({ apiKey: cfg.apiKey });
    cachedKey = cfg.apiKey;
  }
  return cachedClient;
}

/** Drop the cached client — call after the API key changes in settings. */
export function resetPineconeClient(): void {
  cachedClient = null;
  cachedKey = "";
}

/**
 * Deterministic chunk ID.
 *
 * Derived from the document's UUID rather than its file path: Pinecone IDs
 * must be ASCII, and KMUTT filenames are frequently Thai. Deterministic so a
 * re-index overwrites the previous chunks instead of duplicating them, and so
 * deletion can reconstruct the ID list from the stored chunk count.
 */
export function chunkId(docId: string, index: number): string {
  return `${docId}#${index}`;
}

/**
 * Create the index if it does not exist. Idempotent, safe to call on boot.
 *
 * The embedding model is fixed at creation and cannot be changed afterwards —
 * switching models means creating a new index and re-indexing every document.
 */
export async function ensureIndex(): Promise<{ created: boolean; name: string }> {
  const cfg = await getPineconeConfig();
  const pc = getClient(cfg);

  const existing = await pc.listIndexes();
  if (existing.indexes?.some((i) => i.name === cfg.indexName)) {
    return { created: false, name: cfg.indexName };
  }

  await pc.createIndexForModel({
    name: cfg.indexName,
    cloud: cfg.cloud,
    region: cfg.region,
    embed: {
      model: cfg.model,
      fieldMap: { text: TEXT_FIELD },
    },
    waitUntilReady: true,
    suppressConflicts: true, // tolerate a concurrent creator
  });

  return { created: true, name: cfg.indexName };
}

/**
 * Upsert a document's chunks.
 *
 * Deterministic IDs mean re-indexing the same document overwrites in place.
 * If the new version has FEWER chunks than the old one, the surplus tail would
 * survive as orphans — so callers must pass `previousChunkCount` on re-index
 * and this will clean up the difference.
 */
export async function upsertDocument(
  docId: string,
  chunks: Chunk[],
  metadata: ChunkMetadata,
  previousChunkCount = 0
): Promise<{ upserted: number }> {
  if (chunks.length === 0) throw new Error("Refusing to index a document with no text chunks");

  const cfg = await getPineconeConfig();
  const ns = getClient(cfg).index(cfg.indexName).namespace(cfg.namespace);

  const records = chunks.map((c) => ({
    _id: chunkId(docId, c.index),
    [TEXT_FIELD]: c.text,
    chunkIndex: c.index,
    // Pinecone metadata rejects undefined, so only send a real page number
    ...(typeof c.page === "number" ? { page: c.page } : {}),
    ...metadata,
  }));

  for (let i = 0; i < records.length; i += UPSERT_BATCH_SIZE) {
    await ns.upsertRecords({ records: records.slice(i, i + UPSERT_BATCH_SIZE) });
  }

  // Re-index shrank the document — remove the now-orphaned tail chunks.
  if (previousChunkCount > chunks.length) {
    const stale: string[] = [];
    for (let i = chunks.length; i < previousChunkCount; i++) stale.push(chunkId(docId, i));
    await deleteChunkIds(stale);
  }

  return { upserted: records.length };
}

/**
 * Semantic search. Pinecone embeds the query server-side.
 *
 * `filter` uses Pinecone metadata filter syntax, e.g. { category: { $eq: "research" } }.
 */
export async function searchKnowledge(
  query: string,
  topK = 5,
  filter?: object
): Promise<KnowledgeHit[]> {
  if (!query || query.trim().length === 0) return [];

  const cfg = await getPineconeConfig();
  const ns = getClient(cfg).index(cfg.indexName).namespace(cfg.namespace);

  const res = await ns.searchRecords({
    query: {
      topK,
      inputs: { text: query },
      ...(filter ? { filter } : {}),
    },
    fields: [TEXT_FIELD, "docId", "title", "category", "fileName", "chunkIndex", "page"],
  });

  return (res.result?.hits ?? []).map((hit) => {
    const f = (hit.fields ?? {}) as Record<string, any>;
    return {
      id: hit._id,
      score: hit._score,
      text: f[TEXT_FIELD] ?? "",
      docId: f.docId,
      title: f.title,
      category: f.category,
      fileName: f.fileName,
      chunkIndex: typeof f.chunkIndex === "number" ? f.chunkIndex : undefined,
      page: typeof f.page === "number" ? f.page : undefined,
    };
  });
}

/** Delete explicit chunk IDs, batched. */
async function deleteChunkIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const cfg = await getPineconeConfig();
  const ns = getClient(cfg).index(cfg.indexName).namespace(cfg.namespace);
  for (let i = 0; i < ids.length; i += DELETE_BATCH_SIZE) {
    // Must be { ids: [...] }, not a bare array. Passing the array type-checked
    // (DeleteManyOptions is loose enough) but the API rejected it with
    // "Invalid request", so every deletion silently left its vectors behind —
    // the source of the orphaned chunks in the index.
    await ns.deleteMany({ ids: ids.slice(i, i + DELETE_BATCH_SIZE) });
  }
}

/**
 * Remove every chunk belonging to a document.
 *
 * Deletes by explicit ID, NOT by metadata filter: serverless indexes do not
 * support delete-by-filter. This is why the document registry must keep an
 * accurate `chunkCount` — it is the only way to reconstruct the ID list.
 */
export async function deleteDocumentVectors(docId: string, chunkCount: number): Promise<{ deleted: number }> {
  if (chunkCount <= 0) return { deleted: 0 };
  const ids: string[] = [];
  for (let i = 0; i < chunkCount; i++) ids.push(chunkId(docId, i));
  await deleteChunkIds(ids);
  return { deleted: ids.length };
}

/** Index health/stats, for the Settings "test connection" button. */
export async function getIndexStats(): Promise<{
  ok: boolean;
  indexName: string;
  namespace: string;
  dimension?: number;
  totalRecords?: number;
  namespaceRecords?: number;
  error?: string;
}> {
  const cfg = await getPineconeConfig();
  try {
    const pc = getClient(cfg);
    const list = await pc.listIndexes();
    const found = list.indexes?.find((i) => i.name === cfg.indexName);
    if (!found) {
      return { ok: false, indexName: cfg.indexName, namespace: cfg.namespace, error: `Index "${cfg.indexName}" not found` };
    }
    const stats = await pc.index(cfg.indexName).describeIndexStats();
    return {
      ok: true,
      indexName: cfg.indexName,
      namespace: cfg.namespace,
      dimension: found.dimension,
      totalRecords: stats.totalRecordCount,
      namespaceRecords: stats.namespaces?.[cfg.namespace]?.recordCount ?? 0,
    };
  } catch (err: any) {
    return { ok: false, indexName: cfg.indexName, namespace: cfg.namespace, error: err.message };
  }
}

/**
 * Patch metadata on existing vectors WITHOUT re-embedding them.
 *
 * `update` touches only the fields given, leaving the embedding untouched — so
 * page numbers can be added to documents indexed before page tracking existed
 * at no embedding cost. A full re-index would re-embed every chunk and bill for
 * it; this is free and keeps the vectors byte-identical.
 *
 * Pinecone has no batch metadata update, so these go one at a time. A small
 * concurrency window keeps a few hundred chunks quick without tripping limits.
 */
export async function updateChunkMetadata(
  updates: Array<{ id: string; metadata: Record<string, any> }>,
  concurrency = 8
): Promise<{ updated: number; failed: number }> {
  if (updates.length === 0) return { updated: 0, failed: 0 };

  const cfg = await getPineconeConfig();
  const ns = getClient(cfg).index(cfg.indexName).namespace(cfg.namespace);

  let updated = 0;
  let failed = 0;
  let cursor = 0;

  const worker = async () => {
    while (cursor < updates.length) {
      const u = updates[cursor++];
      try {
        await ns.update({ id: u.id, metadata: u.metadata });
        updated++;
      } catch {
        // One bad id must not abort the whole backfill.
        failed++;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, updates.length) }, worker));
  return { updated, failed };
}
