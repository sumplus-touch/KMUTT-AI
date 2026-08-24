import { FastifyInstance } from "fastify";
import { v4 as uuid } from "uuid";
import { getChatHistory, saveChatHistory, ChatSession, deleteAgentHistory } from "../services/data";
import { callTigerBot } from "../services/tigerbot";
import { generateChatTitle } from "../services/titler";

export async function chatRoutes(fastify: FastifyInstance) {
  // Get all chat sessions
  fastify.get("/sessions", async (request, reply) => {
    const sessions = await getChatHistory();
    return sessions.map((s) => ({ id: s.id, title: s.title, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messages.length }));
  });

  // Get single session
  fastify.get("/sessions/:id", async (request, reply) => {
    const sessions = await getChatHistory();
    const session = sessions.find((s) => s.id === (request.params as any).id);
    if (!session) { reply.code(404); return { error: "Session not found" }; }
    return session;
  });

  // Create new session
  fastify.post("/sessions", async (request, reply) => {
    const sessions = await getChatHistory();
    const body = request.body as any;
    const session: ChatSession = {
      id: uuid(),
      title: body.title || "New Chat",
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    sessions.push(session);
    await saveChatHistory(sessions);
    return session;
  });

  // Delete session
  fastify.delete("/sessions/:id", async (request, reply) => {
    const sessionId = (request.params as any).id;
    let sessions = await getChatHistory();
    sessions = sessions.filter((s) => s.id !== sessionId);
    await saveChatHistory(sessions);
    // Clean up agent history folder for this session
    await deleteAgentHistory(sessionId);
    return { success: true };
  });

  // Rename session
  fastify.patch("/sessions/:id", async (request, reply) => {
    const sessions = await getChatHistory();
    const session = sessions.find((s) => s.id === (request.params as any).id);
    if (!session) { reply.code(404); return { error: "Session not found" }; }
    const body = request.body as any;
    if (body.title) session.title = body.title;
    await saveChatHistory(sessions);
    return session;
  });

  /**
   * Generate a short topic name for a chat from its opening prompt.
   *
   * Called right after the first send, so the sidebar shows a meaningful
   * subject instead of a truncated copy of the prompt. Best-effort: any
   * failure leaves the provisional title in place rather than erroring, since
   * the conversation itself must not depend on this.
   */
  fastify.post("/sessions/:id/title", async (request, reply) => {
    const sessionId = (request.params as any).id;
    const prompt = String((request.body as any)?.prompt || "").trim();
    if (!prompt) { reply.code(400); return { error: "prompt required" }; }

    const sessions = await getChatHistory();
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) { reply.code(404); return { error: "Session not found" }; }

    try {
      const title = await generateChatTitle(prompt);
      // Keep the provisional title rather than writing junk into the sidebar.
      if (!title) return { title: session.title, generated: false };

      session.title = title;
      session.updatedAt = new Date().toISOString();
      await saveChatHistory(sessions);
      return { title, generated: true };
    } catch (err: any) {
      return { title: session.title, generated: false, error: err.message };
    }
  });

  // Send message (non-streaming fallback)
  fastify.post("/sessions/:id/messages", async (request, reply) => {
    const sessions = await getChatHistory();
    const session = sessions.find((s) => s.id === (request.params as any).id);
    if (!session) { reply.code(404); return { error: "Session not found" }; }

    const body = request.body as any;
    session.messages.push({
      role: "user",
      content: body.message,
      timestamp: new Date().toISOString(),
    });

    const chatMessages = session.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const result = await callTigerBot(chatMessages);
    session.messages.push({
      role: "assistant",
      content: result.content,
      timestamp: new Date().toISOString(),
    });
    session.updatedAt = new Date().toISOString();
    await saveChatHistory(sessions);

    return { content: result.content, usage: result.usage };
  });
}
