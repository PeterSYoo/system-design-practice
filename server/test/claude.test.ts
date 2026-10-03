import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cliEnv, toolDenial } from "../src/claude.js";
import { parseQuestion } from "../src/question.js";

describe("cliEnv", () => {
  it("strips API keys, base URL overrides, and parent Claude Code session variables", () => {
    const env = cliEnv({
      PATH: "/usr/bin",
      ANTHROPIC_API_KEY: "test-key-not-real",
      ANTHROPIC_AUTH_TOKEN: "test-token-not-real",
      ANTHROPIC_BASE_URL: "http://localhost:9999",
      CLAUDECODE: "1",
      CLAUDE_CODE_ENTRYPOINT: "desktop",
      CLAUDE_CODE_OAUTH_TOKEN: "kept-for-setup-token-logins",
      CLAUDE_CONFIG_DIR: "/home/me/.claude",
    });
    expect(env.PATH).toBe("/usr/bin");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.CLAUDECODE).toBeUndefined();
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("kept-for-setup-token-logins");
    expect(env.CLAUDE_CONFIG_DIR).toBe("/home/me/.claude");
  });
});

describe("toolDenial", () => {
  const root = path.join(os.tmpdir(), "sdp", "sessions");
  const dir = path.join(root, "2026-10-03_1432_url-shortener");

  it("allows Read of a file in the session folder, relative or absolute", () => {
    expect(toolDenial("Read", { file_path: "2026-10-03_1432_url-shortener/review-1.png" }, root, dir)).toBeNull();
    expect(toolDenial("Read", { file_path: path.join(dir, "review-1.png") }, root, dir)).toBeNull();
  });

  it("denies Read outside the session folder", () => {
    expect(toolDenial("Read", { file_path: path.join(os.homedir(), ".ssh", "config") }, root, dir)).toMatch(/outside/);
    expect(toolDenial("Read", { file_path: "other-session/meta.json" }, root, dir)).toMatch(/outside/);
    expect(toolDenial("Read", { file_path: "2026-10-03_1432_url-shortener/../x/y.png" }, root, dir)).toMatch(/outside/);
  });

  it("denies every other tool", () => {
    expect(toolDenial("Bash", { command: "ls" }, root, dir)).toMatch(/not available/);
    expect(toolDenial("Write", { file_path: path.join(dir, "a.txt") }, root, dir)).toMatch(/not available/);
  });
});

describe("parseQuestion", () => {
  it("splits the TITLE line from the question", () => {
    expect(parseQuestion("TITLE: Design a URL shortener\n\nDesign a service that...", true)).toEqual({
      title: "Design a URL shortener",
      body: "Design a service that...",
    });
  });

  it("handles bold markers around TITLE", () => {
    expect(parseQuestion("**TITLE:** Rate limiter\n\nBuild one.", true)?.title).toBe("Rate limiter");
  });

  it("waits while the title line is incomplete", () => {
    expect(parseQuestion("TIT")).toBeNull();
    expect(parseQuestion("TITLE: Design a")).toBeNull();
    expect(parseQuestion("TITLE: Design a chat app\n")).toEqual({ title: "Design a chat app", body: "" });
  });

  it("falls back to the first six words when TITLE is missing", () => {
    const text = "Design a global photo sharing service for mobile users.";
    expect(parseQuestion("Design a global", false)).toBeNull();
    expect(parseQuestion(text, false)).toEqual({ title: "Design a global photo sharing service", body: text });
  });
});
