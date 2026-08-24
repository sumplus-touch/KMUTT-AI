import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { api } from "../utils/api";

/**
 * Shared chat-session store.
 *
 * The sidebar shows Recent chats on EVERY page, but ChatPage only mounts on
 * "/". So the session list, the active id and the running-task set live here
 * (above the router) rather than inside ChatPage — otherwise the list would
 * vanish the moment you navigated away.
 *
 * ChatPage still owns messages/streaming; it reads activeId from here so the
 * sidebar and the canvas can never disagree about which chat is open.
 */

export interface ChatSession {
  id: string;
  title: string;
  createdAt?: string;
  updatedAt?: string;
  messageCount?: number;
}

interface ChatNavValue {
  sessions: ChatSession[];
  refresh: () => Promise<ChatSession[]>;
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  runningIds: Set<string>;
  setRunningIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  /** Optimistically patch one session's title without a round-trip. */
  patchTitle: (id: string, title: string) => void;
}

const ChatNavContext = createContext<ChatNavValue>({
  sessions: [],
  refresh: async () => [],
  activeId: null,
  setActiveId: () => {},
  runningIds: new Set(),
  setRunningIds: () => {},
  patchTitle: () => {},
});

export function ChatNavProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [runningIds, setRunningIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    try {
      const s = await api.getSessions();
      // The API returns sessions in insertion order (oldest first), so they
      // must be sorted here — otherwise "Recent" would show the OLDEST chats
      // and a newly created one would never appear in the collapsed list.
      const list = (Array.isArray(s) ? s : [])
        .slice()
        .sort((a: ChatSession, b: ChatSession) =>
          (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "")
        );
      setSessions(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  const patchTitle = useCallback((id: string, title: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, title } : s)));
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <ChatNavContext.Provider
      value={{ sessions, refresh, activeId, setActiveId, runningIds, setRunningIds, patchTitle }}
    >
      {children}
    </ChatNavContext.Provider>
  );
}

export function useChatNav() {
  return useContext(ChatNavContext);
}
