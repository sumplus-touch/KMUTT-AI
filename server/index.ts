import Fastify from "fastify";
import { createServer } from "http";
import { Server } from "socket.io";
import fastifyCors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import middie from "@fastify/middie";
import path from "path";
import fs from "fs/promises";
import fsSync from "fs";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { chatRoutes } from "./routes/chat";
import { filesRoutes } from "./routes/files";
import { tasksRoutes } from "./routes/tasks";
import { skillsRoutes } from "./routes/skills";
import { settingsRoutes } from "./routes/settings";
import { pythonRoutes } from "./routes/python";
import { toolsRoutes } from "./routes/tools";
import { clawhubRoutes } from "./routes/clawhub";
import { projectsRoutes } from "./routes/projects";
import { agentsRoutes } from "./routes/agents";
import { knowledgeRoutes } from "./routes/knowledge";
import { setupSocket } from "./services/socket";
import { initMcpServers } from "./services/mcp";
import { initScheduler } from "./services/scheduler";
import { getFileTokens, saveFileTokens, generateToken, isValidFileToken } from "./services/data";

dotenv.config();

const ACCESS_TOKEN = process.env.ACCESS_TOKEN || "";
const PORT = Number(process.env.PORT) || 3001;
const SANDBOX_DIR = process.env.SANDBOX_DIR || path.resolve(".");
const DATA_DIR = path.resolve("data");

// Create raw HTTP server for sharing with Socket.io and Vite HMR
const httpServer = createServer();

/**
 * Request logging.
 *
 * `logger: true` emitted a raw pino JSON object for every request, which
 * buried the two or three lines a human actually needs under a firehose of
 * machine noise. Development gets pino-pretty (one readable line per request);
 * production drops to warnings only, so the startup block stays legible.
 * LOG_LEVEL overrides both when you need the detail back.
 */
const isDev = process.env.NODE_ENV !== "production";
const loggerConfig = isDev
  ? {
      level: process.env.LOG_LEVEL || "info",
      transport: {
        target: "pino-pretty",
        options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,reqId,req,res" },
      },
    }
  : { level: process.env.LOG_LEVEL || "warn" };

const fastify = Fastify({
  logger: loggerConfig,
  bodyLimit: 50 * 1024 * 1024, // 50MB
  serverFactory: (handler) => {
    httpServer.on("request", handler);
    return httpServer;
  },
});

// Socket.io on the shared HTTP server
const io = new Server(httpServer, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  maxHttpBufferSize: 50 * 1024 * 1024, // 50MB — match Fastify bodyLimit
});

// Decorate fastify with shared config
fastify.decorate("sandboxDir", SANDBOX_DIR);
fastify.decorate("dataDir", DATA_DIR);

// Augment Fastify types
declare module "fastify" {
  interface FastifyInstance {
    sandboxDir: string;
    dataDir: string;
  }
}

/** Read from package.json so the banner never drifts from the real version. */
const APP_VERSION: string = (() => {
  try {
    return JSON.parse(fsSync.readFileSync(path.resolve("package.json"), "utf-8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

/** Set during boot when a first-run access token is generated; printed last. */
let newlyGeneratedToken = "";

/**
 * Terminal styling for the startup block.
 *
 * Colour is dropped when output is piped or NO_COLOR is set, so redirecting
 * the log to a file produces clean text rather than escape codes.
 */
const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (useColour ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string) => (useColour ? `\x1b[1m${s}\x1b[0m` : s),
  orange: (s: string) => (useColour ? `\x1b[38;5;214m${s}\x1b[0m` : s),
  green: (s: string) => (useColour ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (useColour ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (useColour ? `\x1b[33m${s}\x1b[0m` : s),
  invert: (s: string) => (useColour ? `\x1b[7m${s}\x1b[0m` : s),
};

// Thai-locale cmd.exe renders box-drawing glyphs as garbage; fall back to ASCII.
const unicodeOk = process.platform !== "win32" || Boolean(process.env.WT_SESSION);
const glyph = unicodeOk
  ? { ok: "✓", warn: "!", stop: "✗", tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" }
  : { ok: "[ok]", warn: "[!]", stop: "[x]", tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" };

type Readiness = { label: string; ok: boolean | "warn"; detail: string };

/**
 * One readable block at startup, replacing two bare console.log lines.
 *
 * Shows the version, where the app is, and a state line per subsystem — you
 * could not previously tell whether the knowledge base had connected without
 * opening the app and looking.
 */
function printStartupBanner(version: string, checks: Readiness[]) {
  // Pad the glyph itself: the ASCII fallbacks differ in width ("[ok]" is 4,
  // "[!]" is 3), which would push every label out of column.
  const markWidth = Math.max(glyph.ok.length, glyph.warn.length, glyph.stop.length);
  const mark = (s: Readiness["ok"]) => {
    const raw = s === true ? glyph.ok : s === "warn" ? glyph.warn : glyph.stop;
    const paint = s === true ? c.green : s === "warn" ? c.yellow : c.red;
    return paint(raw) + " ".repeat(markWidth - raw.length);
  };

  console.log("");
  console.log(`  ${c.orange(c.bold("KMUTT AI"))}  ${c.dim("v" + version)}`);
  console.log("");
  for (const chk of checks) {
    console.log(`  ${mark(chk.ok)} ${chk.label.padEnd(15)} ${c.dim(chk.detail)}`);
  }

  // A credential is the last thing on screen, boxed, so it cannot be missed.
  if (newlyGeneratedToken) {
    const line = `  ${glyph.h.repeat(58)}`;
    console.log("");
    console.log(c.dim(line));
    console.log(`  ${c.invert(" ACCESS TOKEN ")}  ${c.bold(newlyGeneratedToken)}`);
    console.log(`  ${c.dim("Paste this when the app asks you to sign in. Shown once.")}`);
    console.log(c.dim(line));
  }
  console.log("");
}

async function start() {
  // Ensure directories exist
  const dirs = [SANDBOX_DIR, DATA_DIR, path.resolve("skills"), path.join(SANDBOX_DIR, "output_file"), path.join(DATA_DIR, "agents")];
  await Promise.all(dirs.map((dir) => fs.mkdir(dir, { recursive: true })));

  // Initialize data files
  const dataFiles = ["chat_history.json", "tasks.json", "settings.json", "skills.json", "projects.json", "file_tokens.json", "knowledge.json"];
  await Promise.all(
    dataFiles.map(async (file) => {
      const fp = path.join(DATA_DIR, file);
      try {
        await fs.access(fp);
      } catch {
        const initial =
          file === "settings.json"
            ? JSON.stringify({ sandboxDir: SANDBOX_DIR, tigerBotApiKey: "", tigerBotModel: "TigerBot-70B-Chat", mcpTools: [], webSearchEnabled: false }, null, 2)
            : "[]";
        await fs.writeFile(fp, initial);
      }
    })
  );

  // Auto-generate a default file access token if none exist
  const tokens = await getFileTokens();
  if (tokens.length === 0) {
    const defaultToken = {
      id: Date.now().toString(36),
      name: "Default",
      token: generateToken(),
      createdAt: new Date().toISOString(),
    };
    await saveFileTokens([defaultToken]);
    // Printed at the very end of startup instead of here — a credential must
    // not scroll past in the middle of the boot log. See printStartupBanner().
    newlyGeneratedToken = defaultToken.token;
  }

  // Register plugins
  await fastify.register(fastifyCors, { origin: "*", methods: ["GET", "POST"] });

  // Auth verify endpoint (no auth required) — registered before auth hook
  fastify.post("/api/auth/verify", async (request, reply) => {
    if (!ACCESS_TOKEN) {
      return { ok: true, required: false };
    }
    const token = (request.body as any).token;
    if (token === ACCESS_TOKEN) {
      return { ok: true };
    }
    reply.code(401);
    return { ok: false, error: "Invalid access token" };
  });

  // API routes with auth hook
  await fastify.register(
    async function apiRoutes(api) {
      // Auth hook for all /api routes
      api.addHook("onRequest", async (request, reply) => {
        // Skip auth verify endpoint
        if (request.url.startsWith("/api/auth/verify")) return;
        if (!ACCESS_TOKEN) return;
        const token = request.headers.authorization?.replace("Bearer ", "") || (request.query as any).token;
        if (token === ACCESS_TOKEN) return;
        // Allow file token for /files routes
        if (request.url.startsWith("/api/files") && token && (await isValidFileToken(token))) return;
        reply.code(401);
        throw new Error("Unauthorized — invalid or missing access token");
      });

      // Register route plugins
      api.register(chatRoutes, { prefix: "/chat" });
      api.register(filesRoutes, { prefix: "/files" });
      api.register(tasksRoutes, { prefix: "/tasks" });
      api.register(skillsRoutes, { prefix: "/skills" });
      api.register(settingsRoutes, { prefix: "/settings" });
      api.register(pythonRoutes, { prefix: "/python" });
      api.register(toolsRoutes, { prefix: "/tools" });
      api.register(clawhubRoutes, { prefix: "/clawhub" });
      api.register(projectsRoutes, { prefix: "/projects" });
      api.register(agentsRoutes, { prefix: "/agents" });
      api.register(knowledgeRoutes, { prefix: "/knowledge" });
    },
    { prefix: "/api" }
  );

  // Sandbox static files — protected by token
  fastify.register(
    async function sandboxRoutes(sandbox) {
      sandbox.addHook("onRequest", async (request, reply) => {
        if (!ACCESS_TOKEN) return;
        const fileToken = ((request.query as any).token as string) || request.headers.authorization?.replace("Bearer ", "");
        if (fileToken && (await isValidFileToken(fileToken))) return;
        if (fileToken === ACCESS_TOKEN) return;
        reply.code(401);
        throw new Error("Unauthorized — invalid or missing file access token");
      });

      sandbox.register(fastifyStatic, {
        root: SANDBOX_DIR,
        prefix: "/",
      });

      // Convert ENOENT errors to clean 404 responses
      sandbox.setErrorHandler(async (error, request, reply) => {
        if ((error as any).code === "ENOENT") {
          reply.code(404);
          return { error: "File not found" };
        }
        reply.code(500);
        return { error: (error as Error).message };
      });
    },
    { prefix: "/sandbox" }
  );

  // Socket.io access token auth
  if (ACCESS_TOKEN) {
    io.use((socket, next) => {
      const token = socket.handshake.auth?.token;
      if (token === ACCESS_TOKEN) return next();
      return next(new Error("Unauthorized — invalid or missing access token"));
    });
  }

  setupSocket(io);

  // Initialize scheduler
  await initScheduler();

  // Vite dev middleware or production static files
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: path.resolve("client"),
      server: {
        middlewareMode: true,
        hmr: { server: httpServer },
      },
    });
    await fastify.register(middie);
    fastify.use(vite.middlewares);
  } else {
    const clientDist = path.resolve("client/dist");
    if (fsSync.existsSync(clientDist)) {
      await fastify.register(fastifyStatic, {
        root: clientDist,
        prefix: "/",
        decorateReply: false, // avoid conflict with sandbox static
      });
      // SPA fallback.
      //
      // Sends index.html directly rather than via reply.sendFile(): the static
      // plugin above is registered with decorateReply:false (to avoid clashing
      // with the sandbox static instance), so reply.sendFile does not exist
      // here. Calling it threw "reply.sendFile is not a function" and turned
      // every deep link / page refresh into a 500.
      const indexHtml = fsSync.readFileSync(path.join(clientDist, "index.html"), "utf-8");
      fastify.setNotFoundHandler(async (request, reply) => {
        if (request.url.startsWith("/api/") || request.url.startsWith("/sandbox/")) {
          reply.code(404);
          return { error: "Not found" };
        }
        return reply.type("text/html").send(indexHtml);
      });
    }
  }

  await fastify.listen({ port: PORT, host: "0.0.0.0" });

  // Report the knowledge base's real state rather than leaving the operator
  // to open the app and guess.
  let kb: Readiness = { label: "Knowledge base", ok: "warn", detail: "not configured" };
  try {
    const { isKnowledgeBaseReady, getIndexStats } = await import("./services/pinecone");
    if (await isKnowledgeBaseReady()) {
      const stats = await getIndexStats();
      kb = stats.ok
        ? { label: "Knowledge base", ok: true, detail: `${stats.indexName} · ${stats.namespaceRecords ?? 0} chunks` }
        : { label: "Knowledge base", ok: false, detail: stats.error || "unreachable" };
    }
  } catch (err: any) {
    kb = { label: "Knowledge base", ok: false, detail: err.message };
  }

  printStartupBanner(APP_VERSION, [
    { label: "Web app", ok: true, detail: `http://localhost:${PORT}` },
    kb,
    { label: "Workspace", ok: true, detail: SANDBOX_DIR },
    { label: "Auth", ok: true, detail: ACCESS_TOKEN ? "access token required" : "open (no ACCESS_TOKEN set)" },
  ]);

  // Initialize MCP servers in background (don't block startup)
  initMcpServers().catch((err) => console.error(c.dim("mcp"), err.message));
}

start();

export { io };
