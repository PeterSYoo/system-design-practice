import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { ClaudeSettings } from "@sdp/shared";
import { dataDir } from "./config.js";
import { atomicWrite } from "./fsutil.js";
import { SettingsSchema } from "./schemas.js";

const settingsFile = () => path.join(dataDir(), "settings.json");

let cached: ClaudeSettings | null = null;

/** Reads settings.json from the data folder. A missing or invalid file means defaults. */
export async function getSettings(): Promise<ClaudeSettings> {
  if (cached) return cached;
  try {
    cached = SettingsSchema.parse(JSON.parse(await readFile(settingsFile(), "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[settings] ignoring ${settingsFile()}: ${err}`);
    cached = {};
  }
  return cached;
}

export async function saveSettings(settings: ClaudeSettings): Promise<ClaudeSettings> {
  await mkdir(dataDir(), { recursive: true });
  await atomicWrite(settingsFile(), JSON.stringify(settings, null, 2));
  cached = settings;
  return settings;
}
