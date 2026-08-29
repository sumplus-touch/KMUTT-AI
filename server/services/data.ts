import fs from "fs/promises";
import path from "path";

const DATA_DIR = path.resolve("data");

async function readJSON(file: string): Promise<any> {
  const fp = path.join(DATA_DIR, file);
  try {
    await fs.access(fp);
    const content = await fs.readFile(fp, "utf-8");
    return JSON.parse(content);
  } catch {
    return file.endsWith("settings.json") ? {} : [];
  }
}

async function writeJSON(file: string, data: any): Promise<void> {
  await fs.writeFile(path.join(DATA_DIR, file), JSON.stringify(data, null, 2));
}

// Chat history
export interface ChatSession {
  id: string;
  title: string;
  messages: Array<{
    role: string;
    content: string;
    timestamp: string;
    files?: string[];
    // Files the user attached to this turn. Persisted so the chips/icons
    // survive a reload — they used to be client-only state and vanished
    // whenever messages were refetched from the server.
    attachments?: Array<{ name: string; path: string; size: number; type: string }>;
    // Knowledge-base documents this answer was grounded in, captured from
    // search_knowledge_base results. Drives the reference box under the reply.
    sources?: Array<{
      /** Inline citation number the model was told to use ([1], [2] …). */
      ref?: number;
      /** Resolves the citation back to its document, so it can be opened. */
      docId?: string;
      title: string;
      fileName?: string;
      category?: string;
      /** 1-based page/sheet the passage came from. */
      page?: number;
      /** True when this passage's text came from OCR rather than a native text layer. */
      ocr?: boolean;
      score: number;
      hits: number;
      excerpt: string;
    }>;
  }>;
  createdAt: string;
  updatedAt: string;
}

export async function getChatHistory(): Promise<ChatSession[]> {
  return readJSON("chat_history.json");
}

/**
 * Serialises every write to chat_history.json.
 *
 * All chat state lives in one file, so concurrent writers interleave their
 * read-modify-write cycles and silently lose each other's updates. Chaining
 * the writes makes each one atomic with respect to the others.
 */
let chatWriteChain: Promise<void> = Promise.resolve();

function queueChatWrite(mutate: (fresh: ChatSession[]) => ChatSession[] | void): Promise<void> {
  chatWriteChain = chatWriteChain
    .catch(() => {})
    .then(async () => {
      const fresh = await readJSON("chat_history.json");
      const next = mutate(fresh) ?? fresh;
      await writeJSON("chat_history.json", next);
    });
  return chatWriteChain;
}

export async function saveChatHistory(sessions: ChatSession[]): Promise<void> {
  await queueChatWrite(() => sessions);
}

/**
 * Persist ONE session without clobbering the others.
 *
 * The socket handler reads the whole history once and then writes it back
 * dozens of times across the life of a request. With several chats running at
 * once, each handler's stale snapshot overwrote the others — messages from
 * concurrent conversations vanished on refresh. Re-reading inside the queued
 * write and replacing only this session keeps every conversation intact.
 */
export async function saveChatSession(session: ChatSession): Promise<void> {
  await queueChatWrite((fresh) => {
    const i = fresh.findIndex((s) => s.id === session.id);
    if (i >= 0) fresh[i] = session;
    else fresh.push(session);
    return fresh;
  });
}

// Tasks (cron)
export interface ScheduledTask {
  id: string;
  name: string;
  cron: string;
  command: string;
  enabled: boolean;
  lastRun?: string;
  lastResult?: string;
  createdAt: string;
}

export async function getTasks(): Promise<ScheduledTask[]> {
  return readJSON("tasks.json");
}

export async function saveTasks(tasks: ScheduledTask[]): Promise<void> {
  await writeJSON("tasks.json", tasks);
}

// Settings
export interface Settings {
  sandboxDir: string;
  tigerBotApiKey: string;
  tigerBotModel: string;
  tigerBotApiUrl?: string;
  mcpTools: Array<{ name: string; url: string; enabled: boolean; type?: string; headers?: Record<string, string> }>;
  webSearchEnabled: boolean;
  webSearchApiKey?: string;
  webSearchEngine?: string;
  pythonPath?: string;
  // Knowledge base (Pinecone, integrated embedding)
  knowledgeBaseEnabled?: boolean;
  pineconeApiKey?: string;
  pineconeIndexName?: string;
  pineconeNamespace?: string;
  pineconeCloud?: string;
  pineconeRegion?: string;
  pineconeModel?: string;
  subAgentEnabled?: boolean;
  subAgentMode?: string; // "auto" | "manual" | "realtime"
  subAgentModel?: string;
  subAgentMaxDepth?: number;
  subAgentMaxConcurrent?: number;
  subAgentTimeout?: number;
  subAgentConfigFile?: string;
  [key: string]: any;
}

export async function getSettings(): Promise<Settings> {
  return readJSON("settings.json");
}

export async function saveSettings(settings: Settings): Promise<void> {
  await writeJSON("settings.json", settings);
}

// Projects
export interface Project {
  id: string;
  name: string;
  description: string;
  workingFolder: string;
  memory: string;
  skills: string[];
  createdAt: string;
  updatedAt: string;
}

export async function getProjects(): Promise<Project[]> {
  return readJSON("projects.json");
}

export async function saveProjects(projects: Project[]): Promise<void> {
  await writeJSON("projects.json", projects);
}

// File Access Tokens
export interface FileToken {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

export async function getFileTokens(): Promise<FileToken[]> {
  return readJSON("file_tokens.json");
}

export async function saveFileTokens(tokens: FileToken[]): Promise<void> {
  await writeJSON("file_tokens.json", tokens);
}

export function generateToken(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  for (let i = 0; i < 48; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

export async function isValidFileToken(token: string): Promise<boolean> {
  const tokens = await getFileTokens();
  return tokens.some((t) => t.token === token);
}

// Skills
export interface Skill {
  id: string;
  name: string;
  description: string;
  source: "claude" | "openclaw" | "custom" | "clawhub";
  script: string;
  enabled: boolean;
  installedAt: string;
}

export async function getSkills(): Promise<Skill[]> {
  return readJSON("skills.json");
}

export async function saveSkills(skills: Skill[]): Promise<void> {
  await writeJSON("skills.json", skills);
}

// Knowledge Base documents
//
// Registry only — the chunk vectors live in Pinecone. `chunkCount` is load-
// bearing: serverless indexes cannot delete by metadata filter, so it is the
// only way to reconstruct a document's chunk IDs for deletion or re-index.
export interface KnowledgeDoc {
  id: string;
  title: string;
  description: string;
  category: string;
  access: "private" | "shared";
  fileName: string;
  filePath: string;   // relative to the sandbox dir
  fileType: string;
  fileSize: number;
  chunkCount: number;
  status: "indexed" | "processing" | "failed";
  error?: string;
  uploadedAt: string;
  indexedAt?: string;
  /** True when this document's text came from OCR rather than a native text layer. */
  ocr?: boolean;
}

export async function getKnowledgeDocs(): Promise<KnowledgeDoc[]> {
  return readJSON("knowledge.json");
}

export async function saveKnowledgeDocs(docs: KnowledgeDoc[]): Promise<void> {
  await writeJSON("knowledge.json", docs);
}

// Agent History (JSONL-based, per-session folder)
const AGENT_HISTORY_DIR = path.join(DATA_DIR, "agent_history");

export async function ensureAgentHistoryDir(sessionId: string): Promise<string> {
  const dir = path.join(AGENT_HISTORY_DIR, sessionId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function appendAgentHistory(sessionId: string, file: string, entry: any): Promise<void> {
  const dir = await ensureAgentHistoryDir(sessionId);
  const fp = path.join(dir, file);
  await fs.appendFile(fp, JSON.stringify(entry) + "\n");
}

export async function readAgentHistory(sessionId: string, file: string): Promise<any[]> {
  const fp = path.join(AGENT_HISTORY_DIR, sessionId, file);
  try {
    const content = await fs.readFile(fp, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function deleteAgentHistory(sessionId: string): Promise<void> {
  const dir = path.join(AGENT_HISTORY_DIR, sessionId);
  await fs.rm(dir, { recursive: true, force: true });
}

export async function flushAgentHistory(_sessionId: string): Promise<void> {
  // JSONL is append-per-call, no buffering needed. Reserved for future batching.
}

// Checkpoint directory for tool loop recovery
const CHECKPOINT_DIR = path.join(DATA_DIR, "checkpoints");

export async function getCheckpointDir(): Promise<string> {
  await fs.mkdir(CHECKPOINT_DIR, { recursive: true });
  return CHECKPOINT_DIR;
}
