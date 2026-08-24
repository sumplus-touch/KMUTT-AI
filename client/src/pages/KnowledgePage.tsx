import { useState, useEffect, useCallback } from "react";
import { api, sandboxUrl } from "../utils/api";
import "./PageStyles.css";
import "./KnowledgePage.css";

interface KnowledgeDoc {
  id: string;
  title: string;
  description: string;
  category: string;
  access: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  chunkCount: number;
  status: "indexed" | "processing" | "failed";
  error?: string;
  uploadedAt: string;
  indexedAt?: string;
  /** Server-computed: the source file is no longer in the workspace. */
  fileMissing?: boolean;
}

interface Hit {
  id: string;
  score: number;
  text: string;
  title?: string;
  category?: string;
  fileName?: string;
  chunkIndex?: number;
}

interface KbStatus {
  ready: boolean;
  configured: boolean;
  indexName?: string;
  namespace?: string;
  dimension?: number;
  namespaceRecords?: number;
  error?: string;
}

// Five groups, down from eight. The originals had three categories
// (navigation, it, student-life) that never received a single document, so a
// third of the browse grid was permanently empty. LEGACY_CATEGORY_MAP folds
// the retired values into their new home so existing documents keep a place.
const CATEGORIES = [
  { value: "regulations", label: "Regulations & Policies", icon: "policy",
    desc: "Official rules, announcements, discipline and administrative procedure." },
  { value: "enrollment", label: "Enrollment & Academics", icon: "school",
    desc: "Registration, add-drop, exams, calendars, curricula and prerequisites." },
  { value: "financial", label: "Fees & Financial", icon: "balance",
    desc: "Tuition schedules, scholarships, reimbursement and payment rules." },
  { value: "research", label: "Research & Graduate", icon: "science",
    desc: "Thesis, defence, graduate study and research guidelines." },
  { value: "other", label: "Other", icon: "folder",
    desc: "Forms, manuals and anything that does not fit another group." },
];

/** Retired category values -> their replacement. */
const LEGACY_CATEGORY_MAP: Record<string, string> = {
  guidelines: "regulations",
  navigation: "enrollment",
  it: "other",
  "student-life": "other",
};

/** Normalise a stored category to one of the five current groups. */
function normaliseCategory(c: string): string {
  const mapped = LEGACY_CATEGORY_MAP[c] || c;
  return CATEGORIES.some((x) => x.value === mapped) ? mapped : "other";
}

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

function KbIcon({ name, size = 24 }: { name: string; size?: number }) {
  const paths: Record<string, string> = {
    school: "M5 13.18v4L12 21l7-3.82v-4L12 17l-7-3.82zM12 3L1 9l11 6 9-4.91V17h2V9L12 3z",
    map: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
    science: "M13 11.33L18 18H6l5-6.67V6h2v5.33M15.96 4H8.04c-.42 0-.65.48-.39.81L9 6.5v4.17L3.2 18.4c-.49.66-.02 1.6.8 1.6h16c.82 0 1.29-.94.8-1.6L15 10.67V6.5l1.35-1.69c.26-.33.03-.81-.39-.81z",
    devices: "M4 6h18V4H4c-1.1 0-2 .9-2 2v11H0v3h14v-3H4V6zm19 2h-6c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h6c.55 0 1-.45 1-1V9c0-.55-.45-1-1-1zm-1 9h-4v-7h4v7z",
    balance: "M11.8 10.9c-2.27-.59-3-1.2-3-2.15 0-1.09 1.01-1.85 2.7-1.85 1.78 0 2.44.85 2.5 2.1h2.21c-.07-1.72-1.12-3.3-3.21-3.81V3h-3v2.16c-1.94.42-3.5 1.68-3.5 3.61 0 2.31 1.91 3.46 4.7 4.13 2.5.6 3 1.48 3 2.41 0 .69-.49 1.79-2.7 1.79-2.06 0-2.87-.92-2.98-2.1h-2.2c.12 2.19 1.76 3.42 3.68 3.83V21h3v-2.15c1.95-.37 3.5-1.5 3.5-3.55 0-2.84-2.43-3.81-4.7-4.4z",
    health: "M10.5 13H8v-3h2.5V7.5h3V10H16v3h-2.5v2.5h-3V13zM12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3z",
    policy: "M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z",
    folder: "M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
    search: "M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    upload: "M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z",
    refresh: "M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-8 8s3.57 8 8 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
    trash: "M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z",
    doc: "M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={paths[name] || paths.folder} />
    </svg>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/**
 * Document viewer.
 *
 * PDFs render in an iframe using the browser's native viewer (served straight
 * from the sandbox). Everything else falls back to the extracted-HTML preview
 * endpoint, which is what Word/Excel need.
 */
function DocViewer({ doc, onClose }: { doc: KnowledgeDoc; onClose: () => void }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const isPdf = doc.filePath.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (isPdf) return; // native viewer handles it
    setLoading(true);
    setError("");
    api.previewFile(doc.filePath)
      .then((d: any) => { d.error ? setError(d.error) : setHtml(d.html || ""); })
      .catch((e: any) => setError(e.message || "Preview failed"))
      .finally(() => setLoading(false));
  }, [doc.filePath, isPdf]);

  return (
    <div className="kb-modal-backdrop" onClick={onClose}>
      <div className="kb-viewer" onClick={(e) => e.stopPropagation()}>
        <header className="kb-modal-head">
          <span className="kb-modal-title" title={doc.title}>
            <KbIcon name="doc" size={20} /> {doc.title}
          </span>
          <div className="kb-viewer-actions">
            <a
              className="btn btn-ghost btn-sm"
              href={api.downloadUrl(doc.filePath)}
              download
              title="Download original"
            >
              Download
            </a>
            <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <KbIcon name="close" size={20} />
            </button>
          </div>
        </header>

        <div className="kb-viewer-meta">
          {CATEGORY_LABEL[normaliseCategory(doc.category)]} · {doc.fileName} · {formatSize(doc.fileSize)} · {doc.chunkCount} indexed chunks
        </div>

        <div className="kb-viewer-body">
          {doc.fileMissing ? (
            <div className="kb-missing-file">
              <strong>The source file is no longer in the workspace.</strong>
              <p>
                Its {doc.chunkCount} chunks are still in Pinecone, so search and chat continue to
                work — but the original <code>{doc.filePath}</code> is gone, so it cannot be
                previewed or re-indexed.
              </p>
              <p className="hint">
                This usually happens when a container rebuild mounts a fresh volume over the
                knowledge directory. Re-upload the file to restore the preview, then delete this
                entry so its old vectors are cleaned up.
              </p>
            </div>
          ) : isPdf ? (
            <iframe title={doc.title} src={sandboxUrl(doc.filePath)} className="kb-viewer-frame" />
          ) : loading ? (
            <div className="empty-state">Loading preview…</div>
          ) : error ? (
            <div className="kb-notice error">Preview unavailable: {error}</div>
          ) : (
            <div className="kb-viewer-html" dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>
      </div>
    </div>
  );
}

export default function KnowledgePage() {
  const [status, setStatus] = useState<KbStatus | null>(null);
  const [docs, setDocs] = useState<KnowledgeDoc[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<KnowledgeDoc | null>(null);
  const [notice, setNotice] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  // Add-document form
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ title: "", category: "other", description: "", access: "private" });
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const refresh = useCallback(() => {
    api.knowledgeStatus().then(setStatus).catch(() => setStatus(null));
    api.getKnowledgeDocs().then((d) => Array.isArray(d) && setDocs(d)).catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const runSearch = async (q: string, category?: string | null) => {
    if (!q.trim()) { setResults(null); return; }
    setSearching(true);
    setNotice(null);
    try {
      const res = await api.searchKnowledge(q, 20, category || undefined);
      if (res.error) { setNotice({ kind: "error", text: res.error }); setResults([]); }
      else setResults(res.results || []);
    } catch (err: any) {
      setNotice({ kind: "error", text: err.message });
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const submitDoc = async () => {
    if (!file || !form.title.trim()) return;
    setUploading(true);
    setNotice(null);
    try {
      const up = await api.uploadFile(file, "knowledge");
      if (up.error) throw new Error(up.error);
      const res = await api.addKnowledgeDoc({
        filePath: up.path,
        title: form.title.trim(),
        description: form.description,
        category: form.category,
        access: form.access,
      });
      if (res.error) throw new Error(res.error);
      setNotice({ kind: "ok", text: `"${res.document.title}" indexed — ${res.document.chunkCount} chunks.` });
      setShowAdd(false);
      setFile(null);
      setForm({ title: "", category: "other", description: "", access: "private" });
      refresh();
    } catch (err: any) {
      setNotice({ kind: "error", text: err.message });
    } finally {
      setUploading(false);
    }
  };

  const reindex = async (id: string) => {
    setBusyId(id);
    try {
      const res = await api.reindexKnowledgeDoc(id);
      setNotice(res.error ? { kind: "error", text: res.error } : { kind: "ok", text: "Re-indexed." });
      refresh();
    } finally { setBusyId(null); }
  };

  const remove = async (doc: KnowledgeDoc) => {
    if (!confirm(`Delete "${doc.title}"? This removes its ${doc.chunkCount} chunks from Pinecone.`)) return;
    setBusyId(doc.id);
    try {
      const res = await api.deleteKnowledgeDoc(doc.id);
      if (res.warning) setNotice({ kind: "error", text: res.warning });
      refresh();
    } finally { setBusyId(null); }
  };

  const notConfigured = status && !status.configured;
  const visibleDocs = activeCategory
    ? docs.filter((d) => normaliseCategory(d.category) === activeCategory)
    : docs;

  return (
    <div className="page kb-page">
      {/* ─── Hero ─── */}
      <div className="kb-hero">
        <h1>KMUTT Knowledge Base</h1>
        <p>Your central hub for academic resources, campus information, and administrative support.</p>
      </div>

      {/* ─── Search + Add ─── */}
      <div className="kb-searchbar-row">
        <div className="kb-searchbar">
          <span className="kb-search-icon"><KbIcon name="search" size={22} /></span>
          <input
            type="text"
            placeholder="Search the Knowledge Base..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runSearch(query, activeCategory)}
          />
          {query && (
            <button className="kb-search-clear" title="Clear" onClick={() => { setQuery(""); setResults(null); }}>
              <KbIcon name="close" size={18} />
            </button>
          )}
          <button className="kb-search-go" onClick={() => runSearch(query, activeCategory)} disabled={searching}>
            <KbIcon name="search" size={20} />
          </button>
        </div>
        <button className="btn btn-primary kb-add-btn" onClick={() => setShowAdd(true)}>
          <KbIcon name="add" size={18} /> Add Document
        </button>
      </div>

      {notice && (
        <div className={`kb-notice ${notice.kind}`}>
          {notice.text}
          <button onClick={() => setNotice(null)}><KbIcon name="close" size={16} /></button>
        </div>
      )}

      {notConfigured && (
        <div className="kb-notice error">
          Knowledge base is not configured — add a Pinecone API key and enable it in Settings.
        </div>
      )}

      {status?.configured && !status.ready && status.error && (
        <div className="kb-notice error">Pinecone: {status.error}</div>
      )}

      {status?.ready && (
        <div className="kb-stats">
          <span><strong>{docs.length}</strong> documents</span>
          <span className="kb-stats-sep" />
          <span><strong>{status.namespaceRecords ?? 0}</strong> indexed chunks</span>
          <span className="kb-stats-sep" />
          <span className="chip-citation">{status.indexName}</span>
        </div>
      )}

      {/* ─── Search results ─── */}
      {results !== null && (
        <section className="kb-section">
          <div className="kb-section-head">
            <h2>{searching ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(""); setResults(null); }}>Clear search</button>
          </div>
          {!searching && results.length === 0 && (
            <div className="empty-state">No matching passages. Try different wording, or add more documents.</div>
          )}
          <div className="kb-results">
            {results.map((h) => (
              <article key={h.id} className="kb-result-card">
                <div className="kb-result-head">
                  <span className="kb-file-badge"><KbIcon name="doc" size={18} /></span>
                  <div className="kb-result-titles">
                    <h3>{h.title || h.fileName}</h3>
                    <span className="kb-result-meta">
                      {h.category && <span className="chip">{CATEGORY_LABEL[normaliseCategory(h.category || "other")]}</span>}
                      {typeof h.chunkIndex === "number" && <span className="kb-chunk">chunk {h.chunkIndex}</span>}
                    </span>
                  </div>
                  <span className="chip-citation kb-score">{(h.score * 100).toFixed(0)}%</span>
                </div>
                <p className="kb-excerpt">{h.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* ─── Category bento grid ─── */}
      {results === null && (
        <section className="kb-section">
          <div className="kb-section-head">
            <h2>Browse by category</h2>
            {activeCategory && (
              <button className="btn btn-ghost btn-sm" onClick={() => setActiveCategory(null)}>Show all</button>
            )}
          </div>
          <div className="kb-bento">
            {CATEGORIES.map((c) => {
              const count = docs.filter((d) => normaliseCategory(d.category) === c.value).length;
              return (
                <button
                  key={c.value}
                  className={`kb-cat-card ${activeCategory === c.value ? "active" : ""}`}
                  onClick={() => setActiveCategory(activeCategory === c.value ? null : c.value)}
                >
                  <span className="kb-cat-icon"><KbIcon name={c.icon} size={26} /></span>
                  <h3>{c.label}</h3>
                  <p>{c.desc}</p>
                  <span className="kb-cat-count">{count} {count === 1 ? "document" : "documents"}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* ─── Document registry ─── */}
      {results === null && (
        <section className="kb-section">
          <div className="kb-section-head">
            <h2>{activeCategory ? CATEGORY_LABEL[activeCategory] : "All documents"}</h2>
          </div>
          {visibleDocs.length === 0 ? (
            <div className="empty-state">
              No documents yet. Use <strong>Add Document</strong> to upload a PDF, Word, Excel, or text file.
            </div>
          ) : (
            <div className="kb-doc-list">
              {visibleDocs.map((d) => (
                <div
                  key={d.id}
                  className="kb-doc-row clickable"
                  onClick={() => setViewing(d)}
                  title="Open document"
                >
                  <span className={`kb-file-badge ${d.fileType}`}><KbIcon name="doc" size={18} /></span>
                  <div className="kb-doc-info">
                    <div className="kb-doc-title">
                      {d.title}
                      <span className={`status-badge ${d.status === "indexed" ? "active" : "inactive"}`}>{d.status}</span>
                      {d.access === "shared" && <span className="chip">shared</span>}
                      {d.fileMissing && (
                        <span className="status-badge missing" title="Source file not found in the workspace">
                          file missing
                        </span>
                      )}
                    </div>
                    <div className="kb-doc-sub">
                      {d.fileName} · {formatSize(d.fileSize)} · {d.chunkCount} chunks · {formatDate(d.indexedAt || d.uploadedAt)}
                    </div>
                    {d.error && <div className="kb-doc-error">{d.error}</div>}
                  </div>
                  <div className="kb-doc-actions" onClick={(e) => e.stopPropagation()}>
                    <button className="btn btn-ghost btn-icon" title="Re-index" disabled={busyId === d.id} onClick={() => reindex(d.id)}>
                      <KbIcon name="refresh" size={18} />
                    </button>
                    <button className="btn btn-danger btn-icon" title="Delete" disabled={busyId === d.id} onClick={() => remove(d)}>
                      <KbIcon name="trash" size={18} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ─── Document viewer ─── */}
      {viewing && <DocViewer doc={viewing} onClose={() => setViewing(null)} />}

      {/* ─── Add Document modal ─── */}
      {showAdd && (
        <div className="kb-modal-backdrop" onClick={() => !uploading && setShowAdd(false)}>
          <div className="kb-modal" onClick={(e) => e.stopPropagation()}>
            <header className="kb-modal-head">
              <span className="kb-modal-title"><KbIcon name="upload" size={20} /> Add Document</span>
              <button className="btn btn-ghost btn-icon" onClick={() => setShowAdd(false)} disabled={uploading}>
                <KbIcon name="close" size={20} />
              </button>
            </header>

            <div className="kb-modal-body">
              <label
                className={`kb-dropzone ${dragOver ? "over" : ""} ${file ? "has-file" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault(); setDragOver(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) { setFile(f); if (!form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, "") })); }
                }}
              >
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.md,.txt,.csv,.json,.xml,.yaml,.yml,.html,.css,.js,.ts,.py"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { setFile(f); if (!form.title) setForm((s) => ({ ...s, title: f.name.replace(/\.[^.]+$/, "") })); }
                  }}
                />
                <span className="kb-dropzone-icon"><KbIcon name="upload" size={30} /></span>
                {file ? (
                  <>
                    <strong>{file.name}</strong>
                    <span className="hint">{formatSize(file.size)} — click to choose a different file</span>
                  </>
                ) : (
                  <>
                    <strong>Click to browse or drop a file here</strong>
                    <span className="hint">PDF, DOCX, XLSX, MD, TXT (max 50 MB)</span>
                  </>
                )}
              </label>

              <div className="form-group">
                <label>Title <span className="kb-req">*</span></label>
                <input
                  type="text"
                  placeholder="Enter document title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Category</label>
                <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>

              <div className="form-group">
                <label>Description (optional)</label>
                <textarea
                  rows={3}
                  placeholder="Add a brief description or abstract..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Knowledge Base Access</label>
                <div className="kb-access">
                  <label className={`kb-access-opt ${form.access === "private" ? "selected" : ""}`}>
                    <input type="radio" name="access" checked={form.access === "private"} onChange={() => setForm({ ...form, access: "private" })} />
                    <span><strong>Private</strong><em>Only available to you in AI Chat.</em></span>
                  </label>
                  <label className={`kb-access-opt ${form.access === "shared" ? "selected" : ""}`}>
                    <input type="radio" name="access" checked={form.access === "shared"} onChange={() => setForm({ ...form, access: "shared" })} />
                    <span><strong>Department Shared</strong><em>Visible to everyone using this workspace.</em></span>
                  </label>
                </div>
              </div>
            </div>

            <footer className="kb-modal-foot">
              <button className="btn btn-secondary" onClick={() => setShowAdd(false)} disabled={uploading}>Cancel</button>
              <button className="btn btn-primary" onClick={submitDoc} disabled={!file || !form.title.trim() || uploading}>
                {uploading ? "Indexing…" : "Upload & Index"}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}
