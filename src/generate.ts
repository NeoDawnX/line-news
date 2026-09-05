import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import type { Article, Category } from "./sources.js";

const ARTICLES_PATH = "debug/articles.json";
const SYLLABUS_PATH = "prompts/syllabus.md";
const SELECT_PROMPT = "prompts/select.md";
const WRITE_PROMPT = "prompts/write.md";
// 選抜時に LLM に見せる本文冒頭。全文は執筆時だけ渡す。
const PREVIEW_CHARS = 300;
const CLAUDE_TIMEOUT_MS = 10 * 60 * 1000;

const DEEP_THEMES = ["週次総括", "産業構造", "企業ケース", "医療政策", "マーケット", "テック", "海外"];

interface Selection {
  macro: string;
  business: string;
  health: string;
  deep: string[];
  reason: string;
}

function jstDate(): { iso: string; weekday: number; dayOfYear: number } {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const iso = now.toISOString().slice(0, 10);
  const start = Date.UTC(now.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((now.getTime() - start) / 86400000);
  return { iso, weekday: now.getUTCDay(), dayOfYear };
}

/** シラバスの番号付き項目を順に取り出す。日付で回すので状態を持たない。 */
async function pickConcept(dayOfYear: number): Promise<string> {
  const md = await readFile(SYLLABUS_PATH, "utf8");
  const items = md.split("\n").filter((l) => /^\d+\.\s/.test(l)).map((l) => l.replace(/^\d+\.\s*/, ""));
  if (!items.length) throw new Error("シラバスが空");
  return items[dayOfYear % items.length];
}

async function claudeBin(): Promise<string> {
  const local = "node_modules/.bin/claude";
  try {
    await access(local);
    return local;
  } catch {
    return "claude";
  }
}

function ask(prompt: string): Promise<string> {
  return new Promise(async (resolve, reject) => {
    const bin = await claudeBin();
    const child = spawn(bin, ["-p", "--output-format", "text"], { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    const timer = setTimeout(() => child.kill(), CLAUDE_TIMEOUT_MS);
    child.stdout.on("data", (d) => out.push(d));
    child.stderr.on("data", (d) => err.push(d));
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exit ${code}: ${Buffer.concat(err).toString()}`));
      resolve(Buffer.concat(out).toString("utf8"));
    });
    child.stdin.end(prompt);
  });
}

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

function parseSelection(raw: string): Selection {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`選抜JSONが見つからない:\n${raw.slice(0, 500)}`);
  return JSON.parse(m[0]) as Selection;
}

/** LLM が前後に付けたコメントを落とし、# DoctorNews から最後の出典行までを残す */
export function trimIssue(raw: string): string {
  const start = raw.indexOf("# DoctorNews");
  let s = start >= 0 ? raw.slice(start) : raw;
  const lastSrc = s.lastIndexOf("\n出典:");
  if (lastSrc >= 0) {
    const end = s.indexOf("\n", lastSrc + 1);
    s = end >= 0 ? s.slice(0, end) : s;
  }
  return s.trim() + "\n";
}

function formatFull(a: Article): string {
  return `#### [${a.id}] ${a.title}\n出典: ${a.url}\n出典元: ${a.source}\n\n${a.body}\n`;
}

async function main() {
  const { iso, weekday, dayOfYear } = jstDate();
  const outPath = `content/${iso}.md`;
  const deepTheme = DEEP_THEMES[weekday];
  const concept = await pickConcept(dayOfYear);

  const all = JSON.parse(await readFile(ARTICLES_PATH, "utf8")) as Article[];
  const pool = all.filter((a) => a.body);
  const byId = new Map(pool.map((a) => [a.id, a]));
  for (const c of ["macro", "business", "health"] as Category[]) {
    if (!pool.some((a) => a.category === c)) throw new Error(`${c} の候補が0件。collect を確認`);
  }
  console.log(`${iso} 深掘り=${deepTheme} 概念=${concept} 候補=${pool.length}件`);

  // 1回目: 選抜
  const candidates = pool
    .map((a) => `- id=${a.id} [${a.category}] ${a.source}｜${a.title}\n  ${a.body!.slice(0, PREVIEW_CHARS).replace(/\s+/g, " ")}`)
    .join("\n");
  const sel = parseSelection(
    await ask(fill(await readFile(SELECT_PROMPT, "utf8"), { DEEP_THEME: deepTheme, CANDIDATES: candidates })),
  );
  const pick = (id: string, label: string): Article => {
    const a = byId.get(id);
    if (!a) throw new Error(`${label}: 存在しない id ${id}`);
    return a;
  };
  const three = [pick(sel.macro, "macro"), pick(sel.business, "business"), pick(sel.health, "health")];
  const deep = sel.deep.map((id) => pick(id, "deep"));
  console.log(`選抜: ${three.map((a) => a.title.slice(0, 20)).join(" / ")}`);
  console.log(`深掘り: ${deep.map((a) => a.title.slice(0, 20)).join(" / ")}`);
  console.log(`理由: ${sel.reason}`);

  // 2回目: 執筆
  const body = await ask(
    fill(await readFile(WRITE_PROMPT, "utf8"), {
      DATE: iso,
      CONCEPT: concept,
      DEEP_THEME: deepTheme,
      SELECTED_ARTICLES: three.map(formatFull).join("\n"),
      DEEP_ARTICLES: deep.map(formatFull).join("\n"),
    }),
  );

  await mkdir("content", { recursive: true });
  await writeFile(outPath, trimIssue(body));
  await writeFile(`debug/selection-${iso}.json`, JSON.stringify({ ...sel, concept, deepTheme }, null, 2));
  console.log(`\n→ ${outPath} (${body.length}字)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
