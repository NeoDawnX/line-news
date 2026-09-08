import { writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import Parser from "rss-parser";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
// v1 は ESM から素直に import すると自己テストを走らせて落ちるので lib を直接読む
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import {
  RSS_SOURCES, GOOGLE_NEWS_QUERIES, googleNewsUrl, DEFAULT_FEED_LIMIT,
  CATEGORY_QUOTAS, OFF_TOPIC, CLASSIFIERS, HN_TOP_N, HN_MIN_SCORE,
  type Article, type Category,
} from "./sources.js";
import { loadSeen, markSeen } from "./seen.js";

const OUT_PATH = "debug/articles.json";
const MAX_BODY_CHARS = 12000;
// これ未満は本文が取れていない（リードだけ、目次だけ）とみなす
const MIN_BODY_CHARS = 600;
const TIMEOUT_MS = 6000;

const parser = new Parser({ timeout: TIMEOUT_MS });
const hashId = (url: string) =>
  createHash("sha1").update(url).digest("hex").slice(0, 12);

/** RSS 由来の utm_* を落とす。出典リンクを綺麗にし、verify の URL 突合も安定する */
function cleanUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (/^utm_/.test(k)) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

/** タイトルからカテゴリを推定。どれにもマッチしなければ null */
function classify(title: string): Category | null {
  for (const c of CLASSIFIERS) if (c.pattern.test(title)) return c.category;
  return null;
}

async function fetchT(url: string): Promise<Response> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: ac.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; DoctorNewsBot/0.1)",
        "Accept-Language": "ja,en;q=0.8",
      },
    });
  } finally {
    clearTimeout(t);
  }
}

// 表計算・アーカイブは本文がないので取りに行かない。PDF は読む（日銀の会見要旨・講演）
const NON_HTML = /\.(xlsx?|docx?|pptx?|csv|zip)(\?|$)/i;
const IS_PDF = /\.pdf(\?|$)/i;

async function extractPdf(res: Response): Promise<string | null> {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 5 * 1024 * 1024) return null;
  const { text } = await pdfParse(buf, { max: 20 });
  const t = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return t.length < MIN_BODY_CHARS ? null : t.slice(0, MAX_BODY_CHARS);
}

async function extractBody(url: string): Promise<string | null> {
  if (NON_HTML.test(url)) return null;
  try {
    const res = await fetchT(url);
    if (!res.ok) return null;
    if (IS_PDF.test(url) || (res.headers.get("content-type") ?? "").includes("pdf")) return await extractPdf(res);
    if (!(res.headers.get("content-type") ?? "").includes("html")) return null;
    const dom = new JSDOM(await res.text(), { url: res.url });
    const parsed = new Readability(dom.window.document).parse();
    dom.window.close();
    const text = parsed?.textContent?.replace(/\s+\n/g, "\n").trim();
    if (!text || text.length < MIN_BODY_CHARS) return null;
    return text.slice(0, MAX_BODY_CHARS);
  } catch {
    return null;
  }
}

async function collectOneRss(src: (typeof RSS_SOURCES)[number]): Promise<Article[]> {
  const out: Article[] = [];
  const t0 = Date.now();
  try {
    const feed = await parser.parseURL(src.url);
    const all = (feed.items ?? []).filter((it) => it.link);
    for (const it of all) it.link = cleanUrl(it.link!);
    const kept = all.filter((it) => {
      const t = it.title ?? "";
      if (OFF_TOPIC.test(t)) return false;
      if (src.excludeTitle?.test(t)) return false;
      if (src.strict && !classify(t)) return false;
      return true;
    });
    const items = kept.slice(0, src.feedLimit ?? DEFAULT_FEED_LIMIT);
    for (const it of items) {
      const title = (it.title ?? "").trim();
      out.push({
        id: hashId(it.link!),
        source: src.label,
        headlineOnly: src.noBody || undefined,
        category: classify(title) ?? src.category,
        title,
        url: it.link!,
        publishedAt: it.isoDate ?? it.pubDate ?? null,
        summary: (it.contentSnippet ?? "").trim().slice(0, 800),
        body: null,
      });
    }
    console.log(`[rss] ${src.label}: ${items.length}件（フィード${all.length}件, 除外${all.length - kept.length}件, ${Date.now() - t0}ms）`);
  } catch (e) {
    console.warn(`[rss] ${src.label}: 失敗 (${Date.now() - t0}ms) -`, (e as Error).message);
  }
  return out;
}

async function collectRss(): Promise<Article[]> {
  // ソース順は保つ（クォータは前から詰めるので、配列の順序が優先度になる）
  return (await Promise.all(RSS_SOURCES.map(collectOneRss))).flat();
}

async function collectGoogleNews(): Promise<Article[]> {
  const results = await Promise.all(
    GOOGLE_NEWS_QUERIES.map(async ({ query, category }) => {
      const out: Article[] = [];
      try {
        const feed = await parser.parseURL(googleNewsUrl(query));
        const items = (feed.items ?? []).slice(0, 10);
        for (const it of items) {
          if (!it.link) continue;
          out.push({
            id: hashId(it.link),
            source: "Google News",
            headlineOnly: true,
            category,
            title: (it.title ?? "").trim(),
            url: it.link,
            publishedAt: it.isoDate ?? it.pubDate ?? null,
            summary: (it.contentSnippet ?? "").trim().slice(0, 400),
            body: null,
          });
        }
        console.log(`[gnews] ${query.slice(0, 16)}…: ${items.length}件`);
      } catch (e) {
        console.warn(`[gnews] ${query.slice(0, 16)}…: 失敗 -`, (e as Error).message);
      }
      return out;
    }),
  );
  return results.flat();
}

async function collectHN(): Promise<Article[]> {
  const out: Article[] = [];
  try {
    const r = await fetchT("https://hacker-news.firebaseio.com/v0/topstories.json");
    const ids = ((await r.json()) as number[]).slice(0, HN_TOP_N);
    const stories = await Promise.all(
      ids.map(async (id) => {
        try {
          const s = await fetchT(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
          return (await s.json()) as { title?: string; url?: string; score?: number; time?: number };
        } catch {
          return null;
        }
      }),
    );
    for (const s of stories) {
      if (!s?.url || !s.title || (s.score ?? 0) < HN_MIN_SCORE) continue;
      out.push({
        id: hashId(s.url),
        source: "Hacker News",
        category: "tech",
        title: s.title,
        url: s.url,
        publishedAt: s.time ? new Date(s.time * 1000).toISOString() : null,
        summary: `HN score: ${s.score}`,
        body: null,
      });
    }
    console.log(`[hn] ${out.length}件 (score>=${HN_MIN_SCORE})`);
  } catch (e) {
    console.warn("[hn] 失敗 -", (e as Error).message);
  }
  return out;
}

/**
 * 本文抽出の対象をカテゴリ別クォータで選ぶ。fresh はソース順・フィード順
 * （＝新しい順）なので、前から詰めれば各カテゴリの新しいものが残る。
 * headlineOnly（NHK, Google News）は対象外。タイトルだけ generate に渡す。
 */
function pickTargets(fresh: Article[]): Article[] {
  const used = new Map<Category, number>();
  const targets: Article[] = [];
  for (const a of fresh) {
    if (a.headlineOnly || NON_HTML.test(a.url)) continue;
    const n = used.get(a.category) ?? 0;
    if (n >= CATEGORY_QUOTAS[a.category]) continue;
    used.set(a.category, n + 1);
    targets.push(a);
  }
  const cats = Object.keys(CATEGORY_QUOTAS) as Category[];
  console.log(`本文抽出の割当: ${cats.map((c) => `${c} ${used.get(c) ?? 0}/${CATEGORY_QUOTAS[c]}`).join(" / ")}`);
  return targets;
}

async function main() {
  setTimeout(() => {
    console.error("collect: 10分を超えたので中断");
    process.exit(2);
  }, 10 * 60 * 1000).unref();
  await mkdir("debug", { recursive: true });
  const seen = await loadSeen();

  const t0 = Date.now();
  const [rss, gnews, hn] = await Promise.all([collectRss(), collectGoogleNews(), collectHN()]);
  const raw = [...rss, ...gnews, ...hn];
  console.log(`収集: ${Date.now() - t0}ms`);

  const byId = new Map<string, Article>();
  for (const a of raw) {
    if (seen.has(a.id) || byId.has(a.id)) continue;
    byId.set(a.id, a);
  }
  const fresh = [...byId.values()];
  console.log(`\n新規: ${fresh.length}件`);

  const targets = pickTargets(fresh);

  console.log(`本文抽出中… ${targets.length}件`);
  const CONCURRENCY = 12;
  let ok = 0, done = 0;
  for (let i = 0; i < targets.length; i += CONCURRENCY) {
    const chunk = targets.slice(i, i + CONCURRENCY);
    await Promise.all(
      chunk.map(async (a) => {
        a.body = await extractBody(a.url);
        done++;
        if (a.body) ok++;
        console.log(`  [${done}/${targets.length}] ${a.body ? "OK " : "-- "} ${a.title.slice(0, 40)}`);
      }),
    );
  }
  console.log(`本文抽出: ${ok}/${targets.length}（${Date.now() - t0}ms）`);

  // カテゴリ別の成功率。0が続くカテゴリはソースを足す必要がある。
  for (const c of Object.keys(CATEGORY_QUOTAS) as Category[]) {
    const t = targets.filter((a) => a.category === c);
    console.log(`  ${c}: ${t.filter((a) => a.body).length}/${t.length}`);
  }

  fresh.sort((a, b) => Number(!!b.body) - Number(!!a.body));
  await writeFile(OUT_PATH, JSON.stringify(fresh, null, 2));
  console.log(`\n→ ${OUT_PATH}`);

  // 本文を取った記事は候補として提示済み扱いにし、翌日は出さない。
  // 動作確認で何度も回したい時は DRY=1。
  if (process.env.DRY !== "1") {
    await markSeen(targets.filter((a) => a.body).map((a) => a.id));
    console.log(`seen.json に ${ok}件 追加`);
  }
}

main().then(
  // JSDOM やソケットがイベントループを掴んで数分終了しないので明示的に抜ける
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
