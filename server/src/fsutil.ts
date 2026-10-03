import { rename, writeFile } from "node:fs/promises";

const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);

/**
 * Runs `fn`, retrying up to 5 times 100 ms apart when Windows reports the file as locked
 * (antivirus or an editor holding it open).
 */
export async function withLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 5 || !code || !RETRYABLE.has(code)) throw err;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
}

/** Writes to `<file>.tmp`, then renames over the target. */
export async function atomicWrite(file: string, data: string | Uint8Array): Promise<void> {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await withLockRetry(() => rename(tmp, file));
}

/** Local time as ISO 8601 with the UTC offset, like 2026-10-03T14:32:10-07:00. */
export function localIso(d = new Date()): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`
  );
}
