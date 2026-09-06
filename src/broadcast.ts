import { readFile } from "node:fs/promises";
import { issueMeta, issueUrl } from "./publish.js";

/**
 * LINE には Flex Message 1通だけ送る: 日付、今日の3本の見出し、今日の1概念、Web へのリンク。
 * 全文は GitHub Pages で読む。
 *   --dry        送らずに JSON を表示
 *   --to <userId> broadcast でなく個人宛て push
 *   YYYY-MM-DD   対象の号（省略時は今日 JST）
 */

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

const row = (icon: string, label: string, text: string) => ({
  type: "box",
  layout: "vertical",
  margin: "lg",
  contents: [
    { type: "text", text: `${icon} ${label}`, size: "xs", color: "#888888" },
    { type: "text", text, size: "sm", wrap: true },
  ],
});

export function buildFlex(md: string) {
  const m = issueMeta(md);
  const url = issueUrl(m.date);
  return {
    type: "flex",
    altText: `DoctorNews ${m.date}｜${m.macro}`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "text", text: "DoctorNews", weight: "bold", size: "lg" },
          { type: "text", text: m.date, size: "xs", color: "#888888" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "none",
        contents: [
          row("🌏", "マクロ", m.macro),
          row("🏢", "ビジネス", m.business),
          row("🏥", "医療", m.health),
          { type: "separator", margin: "xl" },
          row("📖", "今日の1概念", m.concept),
          row("🔍", `深掘り｜${m.deepTheme}`, m.deepTitle),
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: [
          { type: "button", style: "primary", height: "sm", action: { type: "uri", label: "全文を読む", uri: url } },
        ],
      },
    },
  };
}

async function send(message: unknown, to: string | null): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN が未設定");
  const url = to
    ? "https://api.line.me/v2/bot/message/push"
    : "https://api.line.me/v2/bot/message/broadcast";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...(to ? { to } : {}), messages: [message] }),
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
  const flex = buildFlex(md);
  if (dry) {
    console.log(JSON.stringify(flex, null, 2));
    return;
  }
  await send(flex, to);
  console.log(to ? `push → ${to}` : `broadcast 完了: ${issueUrl(date)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
