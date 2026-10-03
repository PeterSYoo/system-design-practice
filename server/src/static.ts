import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Context } from "hono";
import { CLIENT_DIST, isInside } from "./config.js";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json",
  ".wasm": "application/wasm",
};

async function fileResponse(file: string, immutable: boolean): Promise<Response> {
  const body = await readFile(file);
  return new Response(body, {
    headers: {
      "content-type": MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream",
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}

/** Serves client/dist, falling back to index.html for unknown non-API paths. */
export async function serveClient(c: Context): Promise<Response> {
  const urlPath = decodeURIComponent(new URL(c.req.url).pathname);
  const file = path.join(CLIENT_DIST, urlPath);
  if (isInside(file, CLIENT_DIST)) {
    try {
      if ((await stat(file)).isFile()) return fileResponse(file, urlPath.startsWith("/assets/"));
    } catch {
      // not a file, fall through to index.html
    }
  }
  return fileResponse(path.join(CLIENT_DIST, "index.html"), false);
}
