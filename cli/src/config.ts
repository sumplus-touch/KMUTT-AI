/**
 * Where the CLI stores its host and access token.
 *
 * ~/.kmutt/config.json, chmod 600 where the platform supports it. Environment
 * variables win so CI can run without writing a file.
 */
import fs from "fs";
import os from "os";
import path from "path";

export interface Config {
  host: string;
  token?: string;
  lang?: "en" | "th";
}

const DIR = path.join(os.homedir(), ".kmutt");
const FILE = path.join(DIR, "config.json");

export const DEFAULT_HOST = "http://localhost:3001";

export function load(): Config {
  let stored: Partial<Config> = {};
  try {
    stored = JSON.parse(fs.readFileSync(FILE, "utf-8"));
  } catch {
    // no config yet — defaults below
  }
  return {
    host: process.env.KMUTT_HOST || stored.host || DEFAULT_HOST,
    token: process.env.KMUTT_TOKEN || stored.token,
    lang: (process.env.KMUTT_LANG as "en" | "th") || stored.lang,
  };
}

export function save(patch: Partial<Config>): Config {
  const next = { ...load(), ...patch };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next, null, 2));
  // Tokens are credentials — keep them off other accounts on shared machines.
  try { fs.chmodSync(FILE, 0o600); } catch { /* not supported on this platform */ }
  return next;
}

export function configPath(): string {
  return FILE;
}
