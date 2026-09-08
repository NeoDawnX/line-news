import { readFile, writeFile } from "node:fs/promises";
import type { Article } from "./sources.js";

/**
 * 生成した号の数値を、選抜に使った原文と突合する。
 * 原文にない数値が1つでもあれば exit 1（配信を止める）。
 * 固有名詞の突合は誤検出が多いので、まず数値だけを厳密にやる。
 */

const ARTICLES_PATH = "debug/articles.json";

interface Selection {
  macro: string;
  business: string;
  health: string;
  deep: string[];
}

// 単位付きの数値だけを対象にする。「3本」「1つ」のような文章上の数は見ない。
const HARD_UNITS = "円|ドル|ユーロ|元|％|%|億|兆|万|千|人|件|社|台|店|戸|km|キロ|トン|倍|ポイント|pt|年度|年|か月|カ月|ヶ月|日|時間|分|秒|歳|回|位|割";
const NUM_RE = new RegExp(`[0-9０-９][0-9０-９,，.．]*(?:${HARD_UNITS})`, "g");

const toHalf = (s: string) =>
  s
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，]/g, ",")
    .replace(/[．]/g, ".")
    .replace(/％/g, "%")
    .replace(/(\d)[\s　]+(?=[年月日%])/g, "$1");

/** 数値トークンを正規化（全角→半角、桁区切り除去） */
function numbers(text: string): string[] {
  return [...toHalf(text).matchAll(NUM_RE)].map((m) => m[0].replace(/,/g, ""));
}

interface Section {
  name: string;
  text: string;
  sources: Article[];
}

/** 号を「今日の3本の各記事」「概念」「深掘り」に分け、各セクションが根拠にできる原文を対応づける */
function sections(md: string, sel: Selection, byId: Map<string, Article>): Section[] {
  const get = (id: string) => byId.get(id)!;
  const three = [get(sel.macro), get(sel.business), get(sel.health)];
  const deep = sel.deep.map(get);
  const out: Section[] = [];
  const parts = md.split(/^(?=##+ )/m);
  for (const p of parts) {
    const h = p.split("\n")[0];
    if (/^### 🌏/.test(h)) out.push({ name: h, text: p, sources: three });
    else if (/^### 🏢/.test(h)) out.push({ name: h, text: p, sources: three });
    else if (/^### 🏥/.test(h)) out.push({ name: h, text: p, sources: three });
    // 概念は一般知識なので原文突合しない（数式例など）
    else if (/^## 深掘り/.test(h) || /^### /.test(h)) out.push({ name: h, text: p, sources: [...deep, ...three] });
  }
  return out;
}

async function main() {
  const date = process.argv[2] ?? new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const md = await readFile(`content/${date}.md`, "utf8");
  const sel = JSON.parse(await readFile(`debug/selection-${date}.json`, "utf8")) as Selection;
  const all = JSON.parse(await readFile(ARTICLES_PATH, "utf8")) as Article[];
  const byId = new Map(all.map((a) => [a.id, a]));

  let bad = 0;
  const log: string[] = [];
  const say = (line: string) => {
    console.log(line);
    log.push(line);
  };
  for (const s of sections(md, sel, byId)) {
    const corpus = s.sources.map((a) => `${a.title}\n${a.summary}\n${a.body ?? ""}`).join("\n");
    const corpusNums = new Set(numbers(corpus));
    const missing = [...new Set(numbers(s.text))].filter((n) => !corpusNums.has(n));
    if (missing.length) {
      bad += missing.length;
      say(`✗ ${s.name}\n    原文にない数値: ${missing.join(", ")}`);
    } else {
      say(`✓ ${s.name}`);
    }
  }

  // 出典リンクは選抜記事の URL のどれかでなければならない
  const allowed = new Set([sel.macro, sel.business, sel.health, ...sel.deep].map((id) => byId.get(id)!.url));
  const cited = [...md.matchAll(/^出典: (\S+)/gm)].map((m) => m[1]);
  const badUrls = cited.filter((u) => !allowed.has(u));
  if (badUrls.length) {
    bad += badUrls.length;
    say(`✗ 選抜記事にない出典URL: ${badUrls.join(", ")}`);
  }

  const verdict = bad ? `NG: ${bad}件。配信を止める` : "OK";
  console.log(`\n${verdict}`);
  await writeFile(`debug/verify-${date}.log`, [...log, verdict].join("\n") + "\n");
  process.exit(bad ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
