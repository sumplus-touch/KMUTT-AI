import path from "path";
import fs from "fs/promises";
import fsSync from "fs";

/**
 * A safe filename for disk.
 *
 * Most filesystems (ext4 included — what every Docker volume here sits on)
 * cap a filename at 255 BYTES, not 255 characters. Thai text is 3 bytes per
 * character, so a perfectly normal-looking title — "ค่าบำรุง-ค่าธรรมเนียม
 * การศึกษา - ภาควิชา..." — can silently blow past that and throw
 * ENAMETOOLONG the moment anyone uploads it, with no length limit visible
 * anywhere in the UI to explain why.
 *
 * Deterministic: the same long name always truncates to the same disk name,
 * so re-uploading the same file still overwrites it in place rather than
 * piling up copies, matching how a short filename already behaves.
 */
export function safeDiskName(originalName: string, maxStemBytes = 150): string {
  const ext = path.extname(originalName);
  const stem = originalName.slice(0, originalName.length - ext.length);
  if (Buffer.byteLength(stem, "utf-8") <= maxStemBytes) return originalName;

  let hash = 0;
  for (let i = 0; i < originalName.length; i++) hash = (hash * 31 + originalName.charCodeAt(i)) >>> 0;
  const suffix = "-" + hash.toString(16).padStart(8, "0");

  const budget = Math.max(0, maxStemBytes - Buffer.byteLength(suffix, "utf-8"));
  let truncated = Buffer.from(stem, "utf-8").subarray(0, budget).toString("utf-8");
  // Truncating mid-character leaves a replacement char at the cut point — drop it.
  truncated = truncated.replace(/�+$/, "");
  return truncated + suffix + ext;
}

export function validatePath(sandboxDir: string, requestedPath: string): string {
  const resolved = path.resolve(sandboxDir, requestedPath);
  const root = path.resolve(sandboxDir);
  if (!resolved.startsWith(root)) {
    throw new Error("Access denied: path outside workspace");
  }
  return resolved;
}

export async function listFiles(sandboxDir: string, subPath: string = ""): Promise<any[]> {
  const dir = validatePath(sandboxDir, subPath);
  try {
    await fs.access(dir);
  } catch {
    return [];
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = await Promise.all(
    entries.map(async (entry) => {
      const stat = await fs.stat(path.join(dir, entry.name));
      return {
        name: entry.name,
        path: path.join(subPath, entry.name),
        isDirectory: entry.isDirectory(),
        size: entry.isDirectory() ? 0 : stat.size,
        modified: stat.mtime.toISOString(),
      };
    })
  );
  return results;
}

export async function readFile(sandboxDir: string, filePath: string): Promise<string> {
  const resolved = validatePath(sandboxDir, filePath);
  return fs.readFile(resolved, "utf-8");
}

export async function writeFile(sandboxDir: string, filePath: string, content: string): Promise<void> {
  const resolved = validatePath(sandboxDir, filePath);
  const dir = path.dirname(resolved);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(resolved, content);
}

export async function deleteFile(sandboxDir: string, filePath: string): Promise<void> {
  const resolved = validatePath(sandboxDir, filePath);
  const stat = await fs.stat(resolved);
  if (stat.isDirectory()) {
    await fs.rm(resolved, { recursive: true });
  } else {
    await fs.unlink(resolved);
  }
}
