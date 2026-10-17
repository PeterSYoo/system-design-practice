import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// server/src/config.ts in dev and server/dist/index.js in production both sit two levels below the repo root.
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const CLIENT_DIST = path.join(REPO_ROOT, "client", "dist");

export const HOST = "127.0.0.1";
export const PORT = 3001;

/** Set by build.mjs for the bundled server. */
export const PROD = process.env.SDP_MODE === "production";

export const ALLOWED_ORIGINS = PROD
  ? ["http://localhost:3001", "http://127.0.0.1:3001"]
  : ["http://localhost:5173"];

export function dataDir(): string {
  const fromEnv = process.env.SDP_DATA_DIR?.trim();
  return fromEnv ? path.resolve(fromEnv) : path.join(os.homedir(), "system-design-practice-data");
}

export const sessionsDir = () => path.join(dataDir(), "sessions");
export const trashDir = () => path.join(dataDir(), "trash");
export const quizzesDir = () => path.join(dataDir(), "quizzes");

export const claudeModel = () => process.env.SDP_MODEL?.trim() || undefined;

/** True when `child` is `parent` or inside it. Case-insensitive on Windows. */
export function isInside(child: string, parent: string): boolean {
  let c = path.resolve(child);
  let p = path.resolve(parent);
  if (process.platform === "win32") {
    c = c.toLowerCase();
    p = p.toLowerCase();
  }
  const rel = path.relative(p, c);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function readGitignore(): string {
  const file = path.join(REPO_ROOT, ".gitignore");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

/** Directory names a .gitignore ignores at any depth, like `sessions/`. */
function ignoredDirNames(gitignore: string): Set<string> {
  const names = gitignore
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && !l.startsWith("!"))
    .map((l) => l.replace(/\/$/, ""))
    .filter((l) => !l.includes("/") && !l.includes("*"));
  return new Set(names.map((n) => (process.platform === "win32" ? n.toLowerCase() : n)));
}

/**
 * Returns an error message when session data would land inside the repo in a folder
 * .gitignore does not cover, so it could be committed by accident.
 */
export function dataDirProblem(gitignore = readGitignore()): string | null {
  const ignored = ignoredDirNames(gitignore);
  for (const dir of [sessionsDir(), trashDir(), quizzesDir()]) {
    if (!isInside(dir, REPO_ROOT)) continue;
    const segments = path.relative(REPO_ROOT, dir).split(path.sep);
    const covered = segments.some((s) => ignored.has(process.platform === "win32" ? s.toLowerCase() : s));
    if (!covered) {
      return (
        `SDP_DATA_DIR points inside the repo (${dir}) at a path .gitignore does not cover.\n` +
        `Session data could get committed. Point SDP_DATA_DIR outside the repo, or at a folder named data/.`
      );
    }
  }
  return null;
}
