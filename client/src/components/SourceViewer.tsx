import { useEffect, useState } from "react";
import { api, sandboxUrl } from "../utils/api";

export interface CitedSource {
  ref?: number;
  docId?: string;
  title: string;
  fileName?: string;
  category?: string;
  page?: number;
  score: number;
  hits: number;
  excerpt: string;
}

interface ResolvedDoc {
  filePath: string;
  fileMissing: boolean;
  chunkCount: number;
  category: string;
}

/**
 * Resolve citations to the documents behind them.
 *
 * A citation carries only a docId; opening it needs the real path on disk and
 * whether the file is actually present — a deployment can hold the vectors
 * while the source files never travelled, and the viewer has to say so rather
 * than showing a broken frame.
 *
 * Fetched once per page load and shared by every source box.
 */
let docCache: Map<string, ResolvedDoc> | null = null;
let inflight: Promise<Map<string, ResolvedDoc>> | null = null;

function loadDocs(): Promise<Map<string, ResolvedDoc>> {
  if (docCache) return Promise.resolve(docCache);
  if (!inflight) {
    inflight = api
      .getKnowledgeDocs()
      .then((docs: any[]) => {
        const map = new Map<string, ResolvedDoc>();
        for (const d of docs || []) {
          map.set(d.id, {
            filePath: d.filePath,
            fileMissing: Boolean(d.fileMissing),
            chunkCount: d.chunkCount,
            category: d.category,
          });
        }
        docCache = map;
        return map;
      })
      .catch(() => new Map<string, ResolvedDoc>());
  }
  return inflight;
}

export function useResolvedDocs() {
  const [docs, setDocs] = useState<Map<string, ResolvedDoc> | null>(docCache);
  useEffect(() => {
    let alive = true;
    loadDocs().then((m) => alive && setDocs(m));
    return () => { alive = false; };
  }, []);
  return docs;
}

/**
 * Full-document viewer opened from a citation.
 *
 * PDFs open at the cited page via the `#page=` fragment, so the reader lands on
 * the passage rather than page 1 of a 300-page regulation.
 */
export function SourceViewer({
  source,
  resolved,
  onClose,
}: {
  source: CitedSource;
  resolved?: ResolvedDoc;
  onClose: () => void;
}) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const filePath = resolved?.filePath ?? (source.fileName ? `knowledge/${source.fileName}` : "");
  const isPdf = filePath.toLowerCase().endsWith(".pdf");
  const missing = resolved?.fileMissing ?? false;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (isPdf || missing || !filePath) return;
    setLoading(true);
    setError("");
    api.previewFile(filePath)
      .then((d: any) => { d.error ? setError(d.error) : setHtml(d.html || ""); })
      .catch((e: any) => setError(e.message || "Preview failed"))
      .finally(() => setLoading(false));
  }, [filePath, isPdf, missing]);

  // The #page fragment lands the reader on the cited page rather than page 1
  // of a 300-page regulation. It must follow the token query string.
  const frameSrc = filePath ? `${sandboxUrl(filePath)}#page=${source.page ?? 1}` : "";

  return (
    <div className="srcv-backdrop" onClick={onClose}>
      <div className="srcv" onClick={(e) => e.stopPropagation()}>
        <header className="srcv-head">
          <span className="srcv-ref">{source.ref ?? 1}</span>
          <div className="srcv-titles">
            <h3 title={source.title}>{source.title}</h3>
            <span className="srcv-meta">
              {source.fileName}
              {typeof source.page === "number" ? ` · page ${source.page}` : ""}
              {` · ${Math.round((source.score || 0) * 100)}% match`}
            </span>
          </div>
          {!missing && filePath && (
            <a className="srcv-dl" href={api.downloadUrl(filePath)} download title="Download the original file">
              Download
            </a>
          )}
          <button className="srcv-close" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </header>

        {/* The passage the answer actually used, always shown above the document. */}
        <div className="srcv-quote">
          <span className="srcv-quote-label">Cited passage</span>
          <p>{source.excerpt}</p>
        </div>

        <div className="srcv-body">
          {missing || !filePath ? (
            <div className="srcv-missing">
              <strong>The source file is not on this server.</strong>
              <p>
                Its text is indexed, so search and citations work — but the original
                {source.fileName ? <code>{source.fileName}</code> : " file"} is not here to display.
              </p>
              <p className="hint">
                This happens when a deployment carries the Pinecone vectors but not the documents.
                Importing the knowledge bundle restores them.
              </p>
            </div>
          ) : isPdf ? (
            <iframe title={source.title} src={frameSrc} className="srcv-frame" />
          ) : loading ? (
            <div className="srcv-loading">Loading preview…</div>
          ) : error ? (
            <div className="srcv-missing"><strong>Preview unavailable</strong><p>{error}</p></div>
          ) : (
            <div className="srcv-html" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}
