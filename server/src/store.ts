import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ZodType } from "zod";
import type {
  ChatMessage,
  Difficulty,
  SceneFile,
  SessionDetail,
  SessionListItem,
  SessionMeta,
} from "@sdp/shared";
import { atomicWrite, localIso, withLockRetry } from "./fsutil.js";
import { ChatSchema, SceneSchema, SessionMetaSchema } from "./schemas.js";

export class StoreError extends Error {
  constructor(
    public code: "not_found" | "bad_request",
    message: string,
  ) {
    super(message);
  }
}

const ID_RE = /^[a-z0-9_-]+$/;

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  return slug || "session";
}

/** Session ID prefix from local date and time: 2026-10-03_1432 */
function datePrefix(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

const isNotFound = (err: unknown) => (err as NodeJS.ErrnoException).code === "ENOENT";

/** Reads and writes session folders under `<root>/sessions`. All writes for one session run one at a time. */
export class SessionStore {
  readonly sessionsDir: string;
  readonly trashDir: string;
  private queues = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.sessionsDir = path.join(root, "sessions");
    this.trashDir = path.join(root, "trash");
  }

  /** Absolute folder for a session ID. Rejects anything that could escape the sessions folder. */
  dir(id: string): string {
    if (!ID_RE.test(id)) throw new StoreError("bad_request", "Invalid session ID");
    return path.join(this.sessionsDir, id);
  }

  /** Serializes writes per session so an autosave and a chat append never interleave. */
  private enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.queues.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    const settled = next.catch(() => undefined);
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return next;
  }

  private async readJson<T>(id: string, name: string, schema: ZodType<T>): Promise<T> {
    const file = path.join(this.dir(id), name);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (err) {
      if (isNotFound(err)) throw new StoreError("not_found", `Session ${id} not found`);
      throw err;
    }
    return schema.parse(JSON.parse(raw));
  }

  private writeJson(id: string, name: string, value: unknown): Promise<void> {
    return atomicWrite(path.join(this.dir(id), name), JSON.stringify(value, null, 2));
  }

  async list(): Promise<SessionListItem[]> {
    await mkdir(this.sessionsDir, { recursive: true });
    const entries = await readdir(this.sessionsDir, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((e) => e.isDirectory() && ID_RE.test(e.name))
        .map(async (e): Promise<SessionListItem> => {
          try {
            return await this.getMeta(e.name);
          } catch (err) {
            return { id: e.name, unreadable: true, error: err instanceof Error ? err.message : String(err) };
          }
        }),
    );
    const ok = items.filter((i): i is SessionMeta => !("unreadable" in i));
    const broken = items.filter((i) => "unreadable" in i);
    ok.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return [...ok, ...broken];
  }

  async create(input: { title: string; difficulty: Difficulty; question?: string }): Promise<SessionMeta> {
    await mkdir(this.sessionsDir, { recursive: true });
    const now = new Date();
    const base = `${datePrefix(now)}_${slugify(input.title)}`;
    let id = base;
    for (let n = 2; ; n++) {
      try {
        await mkdir(this.dir(id));
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        id = `${base}-${n}`;
      }
    }
    const meta: SessionMeta = {
      id,
      title: input.title,
      difficulty: input.difficulty,
      createdAt: localIso(now),
      updatedAt: localIso(now),
      reviewCount: 0,
    };
    await this.enqueue(id, async () => {
      await this.writeJson(id, "meta.json", meta);
      await this.writeJson(id, "chat.json", []);
      await atomicWrite(path.join(this.dir(id), "question.md"), input.question ?? "");
    });
    return meta;
  }

  getMeta(id: string): Promise<SessionMeta> {
    return this.readJson(id, "meta.json", SessionMetaSchema);
  }

  readChat(id: string): Promise<ChatMessage[]> {
    return this.readJson(id, "chat.json", ChatSchema);
  }

  async readScene(id: string): Promise<SceneFile | null> {
    try {
      return (await this.readJson(id, "scene.excalidraw", SceneSchema)) as SceneFile;
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found") return null;
      throw err;
    }
  }

  async readQuestion(id: string): Promise<string> {
    try {
      return await readFile(path.join(this.dir(id), "question.md"), "utf8");
    } catch (err) {
      if (isNotFound(err)) return "";
      throw err;
    }
  }

  async load(id: string): Promise<SessionDetail> {
    const meta = await this.getMeta(id);
    const [question, scene, chat] = await Promise.all([this.readQuestion(id), this.readScene(id), this.readChat(id)]);
    return { meta, question, scene, chat };
  }

  updateMeta(id: string, patch: Partial<Omit<SessionMeta, "id">>): Promise<SessionMeta> {
    return this.enqueue(id, async () => {
      const meta = { ...(await this.getMeta(id)), ...patch, id, updatedAt: localIso() };
      await this.writeJson(id, "meta.json", meta);
      return meta;
    });
  }

  saveScene(id: string, scene: SceneFile): Promise<string> {
    return this.enqueue(id, async () => {
      const meta = await this.getMeta(id);
      await this.writeJson(id, "scene.excalidraw", scene);
      meta.updatedAt = localIso();
      await this.writeJson(id, "meta.json", meta);
      return meta.updatedAt;
    });
  }

  setQuestion(id: string, text: string): Promise<void> {
    return this.enqueue(id, () => atomicWrite(path.join(this.dir(id), "question.md"), text));
  }

  appendMessages(id: string, ...messages: ChatMessage[]): Promise<void> {
    return this.enqueue(id, async () => {
      const chat = await this.readChat(id);
      chat.push(...messages);
      await this.writeJson(id, "chat.json", chat);
    });
  }

  /** Applies `fn` to one message in chat.json. Returns the updated message. */
  updateMessage(id: string, messageId: string, fn: (m: ChatMessage) => ChatMessage): Promise<ChatMessage> {
    return this.enqueue(id, async () => {
      const chat = await this.readChat(id);
      const i = chat.findIndex((m) => m.id === messageId);
      if (i < 0) throw new StoreError("not_found", `Message ${messageId} not found`);
      chat[i] = fn(chat[i]);
      await this.writeJson(id, "chat.json", chat);
      return chat[i];
    });
  }

  /** Writes a binary file such as review-1.png into the session folder. */
  writeFile(id: string, name: string, data: Uint8Array): Promise<string> {
    if (!/^[a-z0-9_.-]+$/i.test(name) || name.includes("..")) throw new StoreError("bad_request", "Invalid file name");
    const file = path.join(this.dir(id), name);
    return this.enqueue(id, async () => {
      await writeFile(file, data);
      return file;
    });
  }

  /** Moves the session folder into trash/ instead of deleting it. */
  remove(id: string): Promise<void> {
    const from = this.dir(id);
    return this.enqueue(id, async () => {
      // Unreadable sessions can still be trashed, so only check that the folder exists.
      await stat(from).catch((err) => {
        throw isNotFound(err) ? new StoreError("not_found", `Session ${id} not found`) : err;
      });
      await mkdir(this.trashDir, { recursive: true });
      let to = path.join(this.trashDir, id);
      try {
        await readdir(to);
        to = `${to}-${Date.now()}`;
      } catch {
        // target name is free
      }
      await withLockRetry(() => rename(from, to));
    });
  }
}
