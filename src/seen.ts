import { readFile, writeFile } from "node:fs/promises";

const SEEN_PATH = "seen.json";
// 直近これだけ保持。RSSの滞留期間より十分長ければよい。
const KEEP = 3000;

export async function loadSeen(): Promise<Set<string>> {
  try {
    return new Set(JSON.parse(await readFile(SEEN_PATH, "utf8")) as string[]);
  } catch {
    return new Set();
  }
}

/** 既読に追加して保存。古いものから切り捨てる。 */
export async function markSeen(ids: string[]): Promise<void> {
  const prev = [...(await loadSeen())];
  const next = [...new Set([...prev, ...ids])].slice(-KEEP);
  await writeFile(SEEN_PATH, JSON.stringify(next));
}
