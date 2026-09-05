export type Category = "macro" | "business" | "health" | "tech";

export interface SourceDef {
  id: string;
  label: string;
  /** フィード全体の既定カテゴリ。CLASSIFIERS にマッチした記事は上書きされる */
  category: Category;
  url: string;
  /** フィードから拾う最大件数。省略時は DEFAULT_FEED_LIMIT */
  feedLimit?: number;
  /** タイトルがこれにマッチしたら捨てる */
  excludeTitle?: RegExp;
  /** true なら CLASSIFIERS のどれにもマッチしない記事を捨てる（混在フィード用） */
  strict?: boolean;
}

export const DEFAULT_FEED_LIMIT = 20;

// 読者ペルソナに関係ない記事。ソース問わず落とす。
export const OFF_TOPIC =
  /台風|地震|津波|噴火|土砂|豪雨|大雨|警報|猛暑|熱中症|火災|火事|出火|事故|殺害|殺人|遺体|逮捕|容疑|判決|起訴|野球|サッカー|大相撲|ゴルフ|テニス|五輪|W杯|映画|ドラマ|アニメ|芸能|訃報|死去|【動画】|Pickup|療養|入院/;

// タイトルからカテゴリを推定する。上から順に評価し最初にマッチしたものを採用。
// ソース単位の category は「どれにもマッチしなかった時」の既定値。
export const CLASSIFIERS: { category: Category; pattern: RegExp }[] = [
  {
    category: "health",
    pattern: /医療|医師|病院|診療|薬|介護|感染|ワクチン|厚労|厚生労働|看護|年金|製薬|治験|臨床|健康|医学/,
  },
  {
    category: "macro",
    pattern: /日銀|金融政策|為替|円相場|円安|円高|金利|利上げ|利下げ|インフレ|物価|GDP|雇用統計|景気|財政|国債|関税|消費税|減税|FRB|ECB|中央銀行|貿易|経常収支|賃金|春闘|総裁|審議委員/,
  },
  {
    category: "business",
    pattern: /決算|買収|M&A|統合|資金調達|上場|IPO|業績|増益|減益|赤字|黒字|人員削減|リストラ|不正|株価|株主|提携|撤退|参入|値上げ|売上|経営|社長|会長|CEO/,
  },
];

// 厚労省の報道発表は会議案内・事務連絡が大半。「何が起きたか」でないものを落とす。
const MHLW_NOISE =
  /採用情報|議事録|更新しました|更新されました|開催について|開催します|開催案内|会議資料|資料を掲載|国家試験|マガジン|お知らせ|記者会見|遺骨|戦没者|抑留|作業班|検討会|審議会|分科会|部会|ワーキング|募集|ご協力/;

// NOTE: RSSのURLは変わることがあります。collect実行時のログで
// 各ソースの取得件数を必ず確認してください。0件が続くソースは死んでいます。
// NHK のカテゴリ番号は名前と一致しない（cat2=くらし, cat3=科学・文化）。
export const RSS_SOURCES: SourceDef[] = [
  {
    id: "nhk-economy",
    label: "NHK 経済",
    category: "business",
    url: "https://www.nhk.or.jp/rss/news/cat5.xml",
    feedLimit: 30,
  },
  {
    id: "nhk-politics",
    label: "NHK 政治",
    category: "macro",
    url: "https://www.nhk.or.jp/rss/news/cat4.xml",
    strict: true,
  },
  {
    id: "nhk-life",
    label: "NHK くらし",
    category: "health",
    url: "https://www.nhk.or.jp/rss/news/cat2.xml",
    strict: true,
  },
  {
    id: "boj",
    label: "日本銀行",
    category: "macro",
    url: "https://www.boj.or.jp/rss/whatsnew.xml",
    feedLimit: 8,
    excludeTitle: /開催について|募集|採用|入札|公表予定/,
  },
  {
    id: "mhlw",
    label: "厚生労働省 報道発表",
    category: "health",
    url: "https://www.mhlw.go.jp/stf/news.rdf",
    feedLimit: 8,
    excludeTitle: MHLW_NOISE,
  },
  {
    id: "publickey",
    label: "Publickey",
    category: "tech",
    url: "https://www.publickey1.jp/atom.xml",
    feedLimit: 5,
  },
];

// Google News RSS（補助）
// item.link は news.google.com のリダイレクタで本文抽出は失敗する（実測 0/10）。
// 本文は取らず、タイトルだけ「話題の検出」用に渡す。
export const GOOGLE_NEWS_QUERIES: { query: string; category: Category }[] = [
  { query: "日銀 金融政策 OR 為替 OR インフレ", category: "macro" },
  { query: "決算 OR M&A OR 資金調達 スタートアップ", category: "business" },
  { query: "診療報酬 OR 医療政策 OR 薬価", category: "health" },
];

export function googleNewsUrl(query: string): string {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=ja&gl=JP&ceid=JP:ja`;
}

export const HN_TOP_N = 30;
export const HN_MIN_SCORE = 150;

// 本文抽出のカテゴリ別上限。1号に macro/business/health を1本ずつ載せるので、
// どのカテゴリも候補が枯れないように枠を保証する。
export const CATEGORY_QUOTAS: Record<Category, number> = {
  macro: 10,
  business: 10,
  health: 10,
  tech: 8,
};

export interface Article {
  id: string;
  source: string;
  category: Category;
  title: string;
  url: string;
  publishedAt: string | null;
  summary: string;
  body: string | null;
}
