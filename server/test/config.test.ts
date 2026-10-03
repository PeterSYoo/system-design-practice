import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_ROOT, dataDirProblem, isInside } from "../src/config.js";

describe("isInside", () => {
  it("accepts the folder itself and children", () => {
    const base = path.resolve("some", "folder");
    expect(isInside(base, base)).toBe(true);
    expect(isInside(path.join(base, "a", "b.png"), base)).toBe(true);
  });

  it("rejects siblings and parents", () => {
    const base = path.resolve("some", "folder");
    expect(isInside(path.resolve("some", "folder2"), base)).toBe(false);
    expect(isInside(path.join(base, "..", "x"), base)).toBe(false);
  });

  it.runIf(process.platform === "win32")("ignores case on Windows", () => {
    expect(isInside("C:\\Users\\A\\Data\\x", "c:\\users\\a\\data")).toBe(true);
  });
});

describe("dataDirProblem", () => {
  const saved = process.env.SDP_DATA_DIR;
  afterEach(() => {
    if (saved === undefined) delete process.env.SDP_DATA_DIR;
    else process.env.SDP_DATA_DIR = saved;
  });

  it("allows a folder outside the repo", () => {
    process.env.SDP_DATA_DIR = path.resolve(REPO_ROOT, "..", "elsewhere");
    expect(dataDirProblem()).toBeNull();
  });

  it("allows the repo root, since sessions/ and trash/ are ignored", () => {
    process.env.SDP_DATA_DIR = REPO_ROOT;
    expect(dataDirProblem()).toBeNull();
  });

  it("allows a nested folder, since sessions/ matches at any depth", () => {
    process.env.SDP_DATA_DIR = path.join(REPO_ROOT, "server", "my-data");
    expect(dataDirProblem()).toBeNull();
  });

  it("refuses a folder inside the repo that .gitignore does not cover", () => {
    process.env.SDP_DATA_DIR = path.join(REPO_ROOT, "my-data");
    expect(dataDirProblem("node_modules/\ndist/\n")).toMatch(/does not cover/);
    expect(dataDirProblem("node_modules/\nmy-data/\n")).toBeNull();
  });
});
