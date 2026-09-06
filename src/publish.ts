import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";

/**
 * content/*.md を docs/ に HTML 化する。GitHub Pages（main ブランチの /docs）で公開。
 * 依存を増やさないため、この号で使う Markdown 記法だけを扱う最小変換。
 */

export const SITE_URL = "https://neodawnx.github.io/line-news";
const OUT_DIR = "docs";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string): string {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}

export function mdToHtml(md: string): string {
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,3}) (.*)$/);
    if (h) {
      flush();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (/^---+$/.test(line.trim())) {
      flush();
      out.push("<hr>");
    } else if (line.trim() === "") {
      flush();
    } else {
      para.push(line);
    }
  }
  flush();
  return out.join("\n");
}

const CSS = `
:root{color-scheme:light dark}
body{max-width:40rem;margin:0 auto;padding:1.5rem 1rem 4rem;font:16px/1.9 -apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP",sans-serif}
h1{font-size:1.4rem;margin:0 0 1.5rem}h2{font-size:1.2rem;margin:2.5rem 0 .8rem;border-left:4px solid #888;padding-left:.6rem}
h3{font-size:1.05rem;margin:1.8rem 0 .5rem}p{margin:0 0 1em}a{word-break:break-all}
hr{border:0;border-top:1px solid #8884;margin:2rem 0}nav{font-size:.9rem;margin-bottom:1.5rem}
ul{padding-left:1.2rem}li{margin:.3rem 0}
`;

function page(title: string, body: string, nav: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head><body><nav>${nav}</nav>${body}</body></html>\n`;
}

/** 号の見出しを抜く。Flex とインデックスで使う */
export function issueMeta(md: string) {
  const pick = (re: RegExp) => md.match(re)?.[1]?.trim() ?? "";
  return {
    date: pick(/^# DoctorNews (\S+)/m),
    macro: pick(/^### 🌏 マクロ｜(.*)$/m),
    business: pick(/^### 🏢 ビジネス｜(.*)$/m),
    health: pick(/^### 🏥 医療｜(.*)$/m),
    concept: pick(/^## 今日の1概念｜(.*)$/m),
    deepTheme: pick(/^## 深掘り｜(.*)$/m),
    deepTitle: pick(/^## 深掘り｜.*\n+### (.*)$/m),
  };
}

export const issueUrl = (date: string) => `${SITE_URL}/${date}.html`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const files = (await readdir("content")).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort().reverse();
  const index: string[] = [];
  for (const f of files) {
    const md = await readFile(`content/${f}`, "utf8");
    const m = issueMeta(md);
    const nav = `<a href="./">DoctorNews</a> — 過去号一覧`;
    await writeFile(`${OUT_DIR}/${m.date}.html`, page(`DoctorNews ${m.date}`, mdToHtml(md), nav));
    index.push(`<li><a href="${m.date}.html">${m.date}</a> ${esc(m.macro)} ／ ${esc(m.business)} ／ ${esc(m.health)}</li>`);
  }
  await writeFile(`${OUT_DIR}/index.html`, page("DoctorNews", `<h1>DoctorNews</h1><ul>${index.join("")}</ul>`, ""));
  await writeFile(`${OUT_DIR}/.nojekyll`, "");
  console.log(`→ ${OUT_DIR}/ (${files.length}号)`);
}

// broadcast.ts から import されたときは実行しない
if (process.argv[1]?.endsWith("publish.ts")) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
