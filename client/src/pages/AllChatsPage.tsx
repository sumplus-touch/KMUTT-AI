import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../utils/api";
import { Icon } from "../components/Layout";
import { useChatNav } from "../components/ChatNavContext";
import "./AllChatsPage.css";

/**
 * Full chat history — reached from the sidebar's "All Recent" link.
 *
 * The sidebar only ever shows a handful of chats; this is the page that
 * actually contains all of them, with search and delete. Reuses the shared
 * ChatNavContext store so it never drifts from what the sidebar shows.
 */

function formatRelative(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function AllChatsPage() {
  const navigate = useNavigate();
  const { sessions, refresh, activeId, setActiveId, runningIds } = useChatNav();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // ChatNavContext already sorts newest-first; searching just narrows it.
    if (!q) return sessions;
    return sessions.filter((s) => (s.title || "").toLowerCase().includes(q));
  }, [sessions, query]);

  const openChat = (id: string) => {
    setActiveId(id);
    navigate("/");
  };

  const startNewChat = () => {
    setActiveId(null);
    navigate("/");
  };

  const deleteChat = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${title || "this chat"}"? This cannot be undone.`)) return;
    await api.deleteSession(id);
    if (activeId === id) setActiveId(null);
    await refresh();
  };

  return (
    <div className="page allchats-page">
      <div className="page-header allchats-header">
        <div>
          <h1>All Chats</h1>
          <p className="allchats-count">
            {sessions.length} {sessions.length === 1 ? "conversation" : "conversations"}
          </p>
        </div>
        <div className="allchats-actions">
          <div className="allchats-search">
            <Icon name="search" size={16} />
            <input
              type="text"
              placeholder="Search chats…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <button className="btn btn-primary allchats-new" onClick={startNewChat}>
            <Icon name="add" size={18} />
            New Chat
          </button>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="allchats-empty">
          <Icon name="chat" size={40} />
          <h2>No chats yet</h2>
          <p>Start a new chat and it will show up here.</p>
          <button className="btn btn-primary" onClick={startNewChat}>
            <Icon name="add" size={18} /> Start a new chat
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="allchats-empty">
          <p>No chats match "{query}"</p>
        </div>
      ) : (
        <div className="allchats-list">
          {filtered.map((s) => (
            <button
              key={s.id}
              className={`allchats-row ${activeId === s.id ? "active" : ""}`}
              onClick={() => openChat(s.id)}
            >
              <span className="allchats-row-icon">
                {runningIds.has(s.id) ? (
                  <span className="recent-running" title="Task running" />
                ) : (
                  <Icon name="history" size={16} />
                )}
              </span>
              <span className="allchats-row-main">
                <span className="allchats-row-title" title={s.title}>{s.title || "Untitled chat"}</span>
                {typeof s.messageCount === "number" && (
                  <span className="allchats-row-sub">
                    {s.messageCount} {s.messageCount === 1 ? "message" : "messages"}
                  </span>
                )}
              </span>
              <span className="allchats-row-date">{formatRelative(s.updatedAt || s.createdAt)}</span>
              <span
                className="allchats-row-delete"
                onClick={(e) => deleteChat(s.id, s.title, e)}
                role="button"
                aria-label="Delete chat"
                title="Delete chat"
              >
                <Icon name="delete" size={16} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
