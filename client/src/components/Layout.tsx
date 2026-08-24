import { ReactNode, useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { api } from "../utils/api";
import { useChatNav } from "./ChatNavContext";
import "./Layout.css";

// Projects / Files / Skills are intentionally not listed. Their routes still
// work if you navigate to them directly — only the sidebar links are hidden.
const NAV_ITEMS = [
  { path: "/", label: "Chat", icon: "chat" },
  { path: "/knowledge", label: "Knowledge Base", icon: "library" },
  { path: "/tasks", label: "Tasks", icon: "schedule" },
];

/** How many recent chats to show before "All Recent" is expanded. */
const RECENT_COLLAPSED_COUNT = 8;

/** Title shown in each page's sticky header. */
const PAGE_TITLES: Record<string, string> = {
  "/": "KMUTT AI Chat",
  "/knowledge": "Knowledge Base",
  "/projects": "Projects",
  "/files": "Files",
  "/tasks": "Tasks",
  "/skills": "Skills",
  "/settings": "Settings",
};

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const icons: Record<string, string> = {
    chat: "M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z",
    folder: "M10 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z",
    schedule: "M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z",
    extension: "M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5C13 2.12 11.88 1 10.5 1S8 2.12 8 3.5V5H4c-1.1 0-2 .9-2 2v3.8h1.5c1.52 0 2.75 1.23 2.75 2.75S5.02 16.3 3.5 16.3H2V20c0 1.1.9 2 2 2h3.8v-1.5c0-1.52 1.23-2.75 2.75-2.75s2.75 1.23 2.75 2.75V22H17c1.1 0 2-.9 2-2v-4h1.5c1.38 0 2.5-1.12 2.5-2.5S21.88 11 20.5 11z",
    settings: "M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.07.62-.07.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z",
    project: "M12 7V3H2v18h20V7H12zM6 19H4v-2h2v2zm0-4H4v-2h2v2zm0-4H4V9h2v2zm0-4H4V5h2v2zm4 12H8v-2h2v2zm0-4H8v-2h2v2zm0-4H8V9h2v2zm0-4H8V5h2v2zm10 12h-8v-2h2v-2h-2v-2h2v-2h-2V9h8v10zm-2-8h-2v2h2v-2zm0 4h-2v2h2v-2z",
    menu: "M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z",
    close: "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    add: "M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z",
    library: "M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 9H9V9h10v2zm-4 4H9v-2h6v2zm4-8H9V5h10v2z",
    history: "M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z",
    help: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17h-2v-2h2v2zm2.07-7.75l-.9.92C13.45 12.9 13 13.5 13 15h-2v-.5c0-1.1.45-2.1 1.17-2.83l1.24-1.26c.37-.36.59-.86.59-1.41 0-1.1-.9-2-2-2s-2 .9-2 2H8c0-2.21 1.79-4 4-4s4 1.79 4 4c0 .88-.36 1.68-.93 2.25z",
    robot: "M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z",
  };
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d={icons[name] || icons.chat} />
    </svg>
  );
}

export { Icon };

/**
 * KMUTT dot-star mark.
 *
 * The university logo's motif is two plus-signs of dots, offset diagonally by
 * two cells on a 7x7 grid — 16 dots total. Reproduced as circles rather than
 * traced letterforms, since at a 40px tile the "KMUTT" wordmark would be
 * illegible anyway and the sidebar already spells the name out alongside.
 */
function KmuttMark({ size = 26 }: { size?: number }) {
  const CELL = 10;
  const at = (i: number) => 5 + i * CELL;
  const dots: Array<[number, number]> = [];
  // Plus centred on grid cell (2,2)
  for (let r = 0; r <= 4; r++) dots.push([2, r]);
  for (let c = 0; c <= 4; c++) dots.push([c, 2]);
  // Plus centred on grid cell (4,4)
  for (let r = 2; r <= 6; r++) dots.push([4, r]);
  for (let c = 2; c <= 6; c++) dots.push([c, 4]);
  // De-duplicate the cells where the two crosses overlap
  const unique = Array.from(new Set(dots.map(([c, r]) => `${c},${r}`)));

  return (
    <svg width={size} height={size} viewBox="0 0 70 70" aria-label="KMUTT" role="img">
      {unique.map((k) => {
        const [c, r] = k.split(",").map(Number);
        return <circle key={k} cx={at(c)} cy={at(r)} r={4} fill="currentColor" />;
      })}
    </svg>
  );
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return isMobile;
}

export default function Layout({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [swarmEnabled, setSwarmEnabled] = useState(false);
  const [agentMode, setAgentMode] = useState("");
  const [configFileName, setConfigFileName] = useState("");
  const [agentGroupName, setAgentGroupName] = useState("");
  const [agentConfigs, setAgentConfigs] = useState<any[]>([]);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { sessions, refresh, activeId, setActiveId, runningIds } = useChatNav();

  const onChatPage = location.pathname === "/";
  const pageTitle = PAGE_TITLES[location.pathname] || "KMUTT AI";

  useEffect(() => {
    api.getSettings().then((s: any) => {
      setSwarmEnabled(!!s.subAgentEnabled);
      setAgentMode(s.subAgentMode || "auto");
      setConfigFileName(s.subAgentConfigFile || "");
      if (s.subAgentEnabled) {
        api.getAgentConfigs().then((configs: any[]) => {
          setAgentConfigs(configs);
          const current = configs.find((c: any) => c.filename === s.subAgentConfigFile);
          setAgentGroupName(current?.name || (s.subAgentConfigFile ? s.subAgentConfigFile.replace(/\.ya?ml$/, "") : ""));
        }).catch(() => {});
      }
    }).catch(() => {});
  }, [location.pathname]);

  const switchAgentGroup = async (cfg: any) => {
    setShowAgentDropdown(false);
    setAgentGroupName(cfg.name);
    setConfigFileName(cfg.filename);
    const settings = await api.getSettings();
    await api.saveSettings({ ...settings, subAgentConfigFile: cfg.filename });
  };

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    if (isMobile) setDrawerOpen(false);
  }, [location.pathname, isMobile]);

  const handleNav = (path: string) => {
    navigate(path);
    if (isMobile) setDrawerOpen(false);
  };

  // Starting a new chat just clears the active session — the session record is
  // created on first send, so we never leave empty chats lying around.
  const startNewChat = () => {
    setActiveId(null);
    if (!onChatPage) navigate("/");
    if (isMobile) setDrawerOpen(false);
  };

  /** Selecting a chat works from any page — hop to the chat canvas if needed. */
  const selectChat = (id: string) => {
    setActiveId(id);
    if (!onChatPage) navigate("/");
    if (isMobile) setDrawerOpen(false);
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await api.deleteSession(id);
    if (activeId === id) setActiveId(null);
    await refresh();
  };

  const visibleRecent = showAllRecent ? sessions : sessions.slice(0, RECENT_COLLAPSED_COUNT);

  return (
    <div className="layout">
      {/* ─── Mobile top bar ─── */}
      <header className="mobile-topbar">
        <button className="topbar-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu">
          <Icon name="menu" size={22} />
        </button>
        <span className="topbar-title">KMUTT AI</span>
        <button className="topbar-btn" onClick={() => handleNav("/settings")} aria-label="Settings">
          <Icon name="settings" size={22} />
        </button>
      </header>

      {drawerOpen && isMobile && <div className="sidebar-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* ─── Sidebar ─── */}
      <nav className={`sidebar ${drawerOpen ? "drawer-open" : ""}`}>
        <div className="sidebar-brand">
          <div className="brand-mark"><KmuttMark size={26} /></div>
          <div className="brand-text">
            <span className="brand-name">CIVIL KMUTT</span>
            <span className="brand-sub">AI Assistant</span>
          </div>
          <button className="topbar-btn drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="sidebar-newchat">
          <button className="new-chat-pill" onClick={startNewChat}>
            <Icon name="add" size={20} /> New Chat
          </button>
        </div>

        {/* Navigation is fixed — it must not scroll away */}
        <div className="sidebar-nav">
          <div className="sidebar-label">Navigation</div>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.path}
              className={`nav-item ${location.pathname === item.path ? "active" : ""}`}
              onClick={() => handleNav(item.path)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Recent shows on every page; only this list scrolls */}
        <div className="sidebar-label recent-label">
          <span>Recent</span>
          {sessions.length > RECENT_COLLAPSED_COUNT && (
            <button className="all-recent" onClick={() => setShowAllRecent(!showAllRecent)}>
              {showAllRecent ? "Show less" : "All Recent"}
            </button>
          )}
        </div>
        <div className="recent-list">
          {sessions.length === 0 ? (
            <p className="recent-empty">No chats yet.</p>
          ) : (
            visibleRecent.map((s) => (
              <div
                key={s.id}
                className={`recent-item ${activeId === s.id ? "active" : ""}`}
                onClick={() => selectChat(s.id)}
              >
                {runningIds.has(s.id)
                  ? <span className="recent-running" title="Task running" />
                  : <span className="recent-icon"><Icon name="history" size={16} /></span>}
                <span className="recent-title" title={s.title}>{s.title}</span>
                <button className="recent-delete" title="Delete chat" onClick={(e) => deleteChat(s.id, e)}>
                  <Icon name="close" size={14} />
                </button>
              </div>
            ))
          )}
        </div>

        <div className="sidebar-footer">
          <button
            className={`nav-item ${location.pathname === "/settings" ? "active" : ""}`}
            onClick={() => handleNav("/settings")}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
        </div>
      </nav>

      {/* ─── Main ─── */}
      <div className="main-container">
        <div className="page-topbar">
          <h1 className="page-topbar-title">{pageTitle}</h1>
          <div className="page-topbar-actions">
            {swarmEnabled && agentMode === "realtime" && <span className="logo-realtime-tag">Realtime Agent</span>}
            {swarmEnabled && agentMode !== "realtime" && <span className="logo-swarm-tag">Swarm</span>}
            {swarmEnabled && agentGroupName && (
              <div className="agent-group-selector">
                <span
                  className="logo-config-tag clickable"
                  title={`Agent: ${agentGroupName} (${configFileName}) — click to change`}
                  onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                >
                  {agentGroupName}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" style={{ marginLeft: 4 }}>
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </span>
                {showAgentDropdown && (
                  <>
                    <div className="agent-dropdown-backdrop" onClick={() => setShowAgentDropdown(false)} />
                    <div className="agent-dropdown">
                      <div className="agent-dropdown-title">Switch Agent Group</div>
                      {agentConfigs.map((cfg: any) => (
                        <div
                          key={cfg.filename}
                          className={`agent-dropdown-item ${cfg.filename === configFileName ? "active" : ""}`}
                          onClick={() => switchAgentGroup(cfg)}
                        >
                          <span className="agent-dropdown-name">{cfg.name}</span>
                          <span className="agent-dropdown-meta">{cfg.agentCount} agents</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
