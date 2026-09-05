import { readFile } from "node:fs/promises";

// LINE テキストメッセージの上限は 5,000 字、1リクエスト 5 通まで。
const MAX_TEXT = 4900;
const MAX_MESSAGES = 5;

async function loadEnv(): Promise<void> {
  try {
    for (const line of (await readFile(".env", "utf8")).split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    /* .env は任意。Actions では secrets から入る */
  }
}

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Markdown を LINE 向けプレーンテキストに落とす */
function mdToText(md: string): string {
  return md
    .replace(/^# .*\n/m, "")
    .replace(/^### (.*)$/gm, "\n▎$1")
    .replace(/^## (.*)$/gm, "■ $1")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^出典: (.*)$/gm, "→ $1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `## ` 見出しごとに分割して1通ずつにする */
function splitIssue(md: string): string[] {
  const title = md.match(/^# (.*)$/m)?.[1] ?? "DoctorNews";
  const sections = md.split(/^(?=## )/m).filter((s) => s.startsWith("## "));
  const msgs = sections.map((s, i) => (i === 0 ? `${title}\n\n` : "") + mdToText(s));
  for (const m of msgs) {
    if (m.length > MAX_TEXT) throw new Error(`1通が ${m.length} 字。上限 ${MAX_TEXT}`);
  }
  if (msgs.length > MAX_MESSAGES) throw new Error(`${msgs.length} 通。上限 ${MAX_MESSAGES}`);
  return msgs;
}

async function send(messages: string[], to: string | null): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が未設定");
  const url = to
    ? "https://api.line.me/v2/bot/message/push"
    : "https://api.line.me/v2/bot/message/broadcast";
  const body = {
    ...(to ? { to } : {}),
    messages: messages.map((text) => ({ type: "text", text })),
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`LINE ${res.status}: ${await res.text()}`);
}

async function main() {
  await loadEnv();
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const toIdx = args.indexOf("--to");
  const to = toIdx >= 0 ? args[toIdx + 1] : null;
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ?? jstToday();

  const md = await readFile(`content/${date}.md`, "utf8");
  const messages = splitIssue(md);
  console.log(`${date}: ${messages.length}通 (${messages.map((m) => m.length).join(" / ")} 字)`);

  if (dry) {
    for (const [i, m] of messages.entries()) console.log(`\n===== ${i + 1}通目 =====\n${m}`);
    return;
  }
  await send(messages, to);
  console.log(to ? `push → ${to}` : "broadcast 完了");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
