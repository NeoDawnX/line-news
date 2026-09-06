# DoctorNews

日刊ニュースレター。LINE公式アカウント @096amlav (DoctorNews) に毎朝7時配信する。

## 読者ペルソナ
臨床から離れてキャリアを作る若手医師。医系技官・戦略コンサル・投資銀行を視野。
経済/金融/企業経営の基礎知識と時事の蓄積が同世代のビジネス職より数年ぶん足りない
自覚がある。1日15-20分しか読めない。
求めているのは「何が起きたか」ではなく「どの枠組みで理解するか」。

## 1号の構成（合計 約3,700字）
- 今日の3本: macro / business / health を各1件、各400-600字
- 今日の1概念: 600-800字（ビジネス基礎。シラバスを別途固定）
- 深掘り: 1,500字。曜日ローテ
  - 月:産業構造 火:企業ケース 水:医療政策 木:マーケット 金:テック 土:海外 日:週次総括

## パイプライン
collect (RSS/HN取得・本文抽出) → generate (claude -p 2回: 選抜→執筆)
→ verify (数値・固有名詞の原文突合) → content/YYYY-MM-DD.md
→ publish (Markdown→HTML, GitHub Pages) → broadcast (LINE Flex 1通: 3本の見出し＋概念名＋Webへのリンク)

実行: GitHub Actions cron 06:40 JST。LLMは `claude -p`（Maxサブスク枠）。

## 設計上の決定事項
- 本文全文をLLMに渡す。RSSのdescriptionだけで書かせると捏造する
- 本文抽出に失敗した記事は選抜対象から外す（無理に使わない）
- verify を通す前に外部の友だちを増やさない
- 著作権: 原文の言い回しを流用しない。必ず自分の言葉に。出典リンク必須

## 現状
- [x] LINE Messaging API 疎通確認済み
- [x] src/sources.ts, src/collect.ts, src/seen.ts
- [x] 収集の偏り修正（2026-09-05）
- [x] src/generate.ts（2026-09-05 初号生成）
- [x] src/broadcast.ts（テキスト3通版。Flex化は未）
- [ ] .github/workflows/daily.yml

## 収集の設計（2026-09-05 時点）
- カテゴリはソース単位でなく記事タイトルで判定（sources.ts CLASSIFIERS）。
  NHK経済はmacroとbusinessが混在するため
- 本文抽出はカテゴリ別クォータ macro10/business10/health10/tech8。
  ソース別だと macro 枠が災害ニュースで埋まった
- 災害・スポーツ・事件・芸能は OFF_TOPIC で全ソース一律除外
- Google News は本文が取れない（実測 0/10）ので title のみ。話題検出用
- NHK RSS の番号は名前と一致しない: cat2=くらし(health向き) cat4=政治 cat5=経済
- 医療専門紙・財務省・内閣府の RSS は全滅。日銀は生きている
- 本文を取った記事は seen.json に記録し翌日は出さない。動作確認は DRY=1
- 本文の中央値は約1,500字。深掘り1,500字を1記事から書くと水増しになる。
  generate では複数記事を束ねる前提にすること

## 配信形式（2026-09-06 決定）
LINE は Flex Message 1通のみ: 日付、今日の3本の見出し、今日の1概念の名前、Web へのリンク。
全文は GitHub Pages のアーカイブで読む。LINE の5,000字制限と分割配信を避けるため。

## 次にやること
1. verify.ts（数値・固有名詞の原文突合。NG なら配信停止）
2. publish（content/*.md → HTML → GitHub Pages）
3. broadcast.ts を Flex 1通に変更
4. .github/workflows/daily.yml
