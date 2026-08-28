import { FastifyInstance } from "fastify";
import { listFiles, readFile, writeFile, deleteFile, validatePath } from "../services/sandbox";
import multipart from "@fastify/multipart";
import path from "path";
import fs from "fs";
import { createReadStream } from "fs";
import { extractPreview, isPreviewable } from "../services/extract";

const ALLOWED_CHAT_EXTENSIONS = [
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt", ".json", ".xml",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg",
  ".py", ".js", ".ts", ".html", ".css", ".md", ".yaml", ".yml",
  ".zip", ".tar", ".gz",
];

export async function filesRoutes(fastify: FastifyInstance) {
  // 200MB — matches the Fastify bodyLimit, so a bulk knowledge-base .zip
  // upload isn't rejected before it ever reaches the extraction route.
  await fastify.register(multipart, { limits: { fileSize: 200 * 1024 * 1024 } });

  fastify.get("/", async (request, reply) => {
    try {
      const subPath = (request.query as any).path || "";
      const files = await listFiles(request.server.sandboxDir, subPath);
      return files;
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });

  fastify.get("/read", async (request, reply) => {
    try {
      const filePath = (request.query as any).path as string;
      if (!filePath) { reply.code(400); return { error: "path required" }; }
      const content = await readFile(request.server.sandboxDir, filePath);
      return { content, path: filePath };
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });

  fastify.post("/write", async (request, reply) => {
    try {
      const { path: filePath, content } = request.body as any;
      if (!filePath) { reply.code(400); return { error: "path required" }; }
      await writeFile(request.server.sandboxDir, filePath, content || "");
      return { success: true, path: filePath };
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });

  fastify.delete("/", async (request, reply) => {
    try {
      const filePath = (request.query as any).path as string;
      if (!filePath) { reply.code(400); return { error: "path required" }; }
      await deleteFile(request.server.sandboxDir, filePath);
      return { success: true };
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });

  // Mkdir
  fastify.post("/mkdir", async (request, reply) => {
    try {
      const dirPath = (request.body as any).path;
      if (!dirPath) { reply.code(400); return { error: "path required" }; }
      const resolved = validatePath(request.server.sandboxDir, dirPath);
      if (!fs.existsSync(resolved)) fs.mkdirSync(resolved, { recursive: true });
      return { success: true, path: dirPath };
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });

  // Upload
  fastify.post("/upload", async (request, reply) => {
    try {
      const data = await request.file();
      if (!data) { reply.code(400); return { error: "No file" }; }

      const buffer = await data.toBuffer();
      const originalname = data.filename;

      // Extract path field from multipart fields
      const pathField = data.fields?.path as any;
      const destDir = pathField?.value || "";
      const destPath = destDir ? destDir + "/" + originalname : originalname;
      const resolved = validatePath(request.server.sandboxDir, destPath);
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(resolved, buffer);
      return { success: true, path: destPath };
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });

  // Chat file upload (multiple files, saved to uploads/ in sandbox)
  fastify.post("/chat-upload", async (request, reply) => {
    try {
      const parts = request.files();
      const sandboxDir = request.server.sandboxDir;
      const uploadsDir = path.join(sandboxDir, "uploads");
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      const uploaded: { name: string; path: string; size: number; type: string }[] = [];

      for await (const part of parts) {
        const ext = path.extname(part.filename).toLowerCase();
        if (!ALLOWED_CHAT_EXTENSIONS.includes(ext)) {
          continue; // skip disallowed extensions
        }

        const buffer = await part.toBuffer();
        const safeName = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const destName = `${Date.now()}_${safeName}`;
        const destPath = path.join(uploadsDir, destName);
        fs.writeFileSync(destPath, buffer);
        uploaded.push({
          name: part.filename,
          path: `uploads/${destName}`,
          size: buffer.length,
          type: part.mimetype,
        });
      }

      if (uploaded.length === 0) { reply.code(400); return { error: "No files" }; }
      return { success: true, files: uploaded };
    } catch (err: any) {
      reply.code(500); return { error: err.message };
    }
  });

  // Preview PDF / DOCX -- returns extracted HTML content
  fastify.get("/preview", async (request, reply) => {
    try {
      const filePath = (request.query as any).path as string;
      if (!filePath) { reply.code(400); return { error: "path required" }; }
      const resolved = validatePath(request.server.sandboxDir, filePath);
      if (!fs.existsSync(resolved)) { reply.code(404); return { error: "File not found" }; }
      if (!isPreviewable(resolved)) { reply.code(400); return { error: "Unsupported file type for preview" }; }

      return await extractPreview(resolved);
    } catch (err: any) {
      reply.code(500); return { error: err.message };
    }
  });

  // Download
  fastify.get("/download", async (request, reply) => {
    try {
      const filePath = (request.query as any).path as string;
      if (!filePath) { reply.code(400); return { error: "path required" }; }
      const resolved = validatePath(request.server.sandboxDir, filePath);
      const fileName = path.basename(resolved);
      reply.header("Content-Disposition", `attachment; filename="${fileName}"`);
      return reply.send(createReadStream(resolved));
    } catch (err: any) {
      reply.code(403); return { error: err.message };
    }
  });
}
