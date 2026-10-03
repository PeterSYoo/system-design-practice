import type { Context } from "hono";
import { ZodError } from "zod";
import { StoreError } from "../store.js";

/** Maps store and validation errors to JSON responses. */
export function errorResponse(c: Context, err: unknown): Response {
  if (err instanceof StoreError) {
    return c.json({ message: err.message, code: err.code }, err.code === "not_found" ? 404 : 400);
  }
  if (err instanceof ZodError || err instanceof SyntaxError) {
    return c.json({ message: "Invalid request body", code: "bad_request" }, 400);
  }
  console.error(err);
  return c.json({ message: "Internal error", code: "claude_failed" }, 500);
}
