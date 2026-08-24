/**
 * Typed client for the server's existing /api routes.
 *
 * The CLI is a client of the REST surface, not a reimplementation — every
 * command here maps onto an endpoint the web app already uses.
 */
import { load } from "./config";

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  status: "indexed" | "processing" | "failed";
  error?: string;
  access: string;
  uploadedAt: string;
  indexedAt?: string;
  fileMissing?: boolean;
}

export interface Hit {
  id: string;
  score: number;
  text: string;
  title?: string;
  fileName?: string;
  category?: string;
  page?: number;
  chunkIndex?: number;
}

export interface KbStatus {
  ready: boolean;
  configured: boolean;
  indexName?: string;
  namespace?: string;
  dimension?: number;
  totalRecords?: number;
  namespaceRecords?: number;
  error?: string;
}

/** Thrown with a machine-readable code so messages can map to a help page. */
export class ApiError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { host, token } = load();
  let res: Response;
  try {
    res = await fetch(`${host}${path}`, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(init?.headers as Record<string, string>),
      },
    });
  } catch (err: any) {
    throw new ApiError(`Cannot reach ${host}`, "SERVER_UNREACHABLE");
  }

  if (res.status === 401) throw new ApiError(`Not signed in to ${host}`, "NOT_AUTHENTICATED", 401);

  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(body?.error || `Request failed (${res.status})`, "REQUEST_FAILED", res.status);
  }
  return body as T;
}

export const api = {
  host: () => load().host,
  status: () => request<KbStatus>("/api/knowledge/status"),
  documents: () => request<KnowledgeDoc[]>("/api/knowledge/documents"),
  search: (query: string, topK = 8, category?: string) =>
    request<{ query: string; count: number; results: Hit[] }>("/api/knowledge/search", {
      method: "POST",
      body: JSON.stringify({ query, topK, category }),
    }),
  addDocument: (d: { filePath: string; title: string; description?: string; category?: string; access?: string }) =>
    request<{ success: boolean; document: KnowledgeDoc }>("/api/knowledge/documents", {
      method: "POST",
      body: JSON.stringify(d),
    }),
  reindex: (id: string) =>
    request<{ success: boolean; document: KnowledgeDoc }>(`/api/knowledge/documents/${id}/reindex`, { method: "POST" }),
  remove: (id: string) =>
    request<{ success: boolean; warning?: string }>(`/api/knowledge/documents/${id}`, { method: "DELETE" }),
  settings: () => request<Record<string, any>>("/api/settings"),
};
