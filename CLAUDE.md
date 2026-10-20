# CLAUDE.md

## プロジェクト概要
**Vege-Table** — デイリーパズル（3マッチ）で、おじゃまタイルを全て消すまでの手数を競うカジュアルゲーム。Wordleモデル。
モードは Clear だけ（Sprint / Survival / Cascade は #102 で撤去した）。
仕様の正本は `docs/SPEC.md`。ゲームルール、API、データ構造に関わる変更の前に、該当する節を読む。

※ 本番URL `https://vegtab.app`

## リポジトリ構成
```
project/
├── engine/             # パズルエンジン（純粋TypeScript、フレームワーク非依存）
├── frontend/           # Vue.js SPA
├── backend/            # Cloudflare Workers API
├── docs/
│   └── SPEC.md         # 全仕様書
├── package.json        # npm workspaces
└── CLAUDE.md           # このファイル
```

## 開発フェーズ
Phase 1 〜 3.12 は完了、Phase 4 は中止。各Phaseの詳細は `docs/SPEC.md` §7 を参照。
- Phase 1 (Core Engine): 完了。3モード・おじゃまタイル・スプーンバフ・Survivalウェーブ制侵食実装済み。
- Phase 2 (Frontend UI): 完了。野菜テーマ・モード選択UI・おじゃまタイル表示・Survivalウェーブ表示実装済み。
- Phase 3 (Backend API): 完了。モード対応・ベストスコアupsert・ランキング実装済み。
- Phase 3.5 (Pre-release): 完了。α版公開済み。シェア・i18n・ダークモード・SE/BGM。
- Phase 3.7 (UXポリッシュ & 機能追加): 完了。実績システム・アカウント引き継ぎ・各種UX改善。
- Phase 3.8 (手順再生 & スコア送信修正): 完了。リプレイビューア・カレンダースコア送信・未送信スコア再送。
- Phase 3.9 (チュートリアル): 完了。紙芝居チュートリアル（当時21ステップ、今は18ステップ）・準備完了実績・アイテム名リネーム。
- Phase 3.11 (Cascade改善Phase1): 完了。連鎖ポテンシャル表示・連鎖メーター・マイルストーンボーナス・NEW BEST演出。
- Phase 3.12 (Cascade改善Phase2): 完了。キラキラ野菜（初期配置+補充+キラキラCP加算+ネクスト表示反映）。
- Phase 4 (Native & Monetization): 中止。ネイティブアプリ（Capacitor の Android / iOS）は作らず、Web と PWA だけにする。
- #102 (Clear への絞り込み): Sprint / Survival / Cascade とその専用の仕組みを engine・frontend・backend から撤去した。上の Phase の記述のうちそれらに関するものは、現在の仕様ではない。

## 技術スタック
- **言語:** TypeScript (全パッケージ共通)
- **パッケージ管理:** npm workspaces
- **テスト:** Vitest
- **フロントエンド:** Vue.js (Composition API), Pinia, vue-i18n
- **バックエンド:** Cloudflare Workers (Hono), D1 (SQLite), KV, R2
- **認証:** JWT (jose) — アクセストークン(1h) + リフレッシュトークン(90d)

## 環境セットアップ

### 初回セットアップ
```bash
npm install                    # ルートで全 workspace の依存をインストール
```

**`package-lock.json` を削除してから作り直さないこと。** npm がその時点の
プラットフォーム向けの optional な native binding（`@rolldown/binding-*` /
`@rollup/rollup-*` / `@esbuild/*`）しか lockfile に残さないため、Linux で
作り直すと macOS や Windows での `npm ci` 後のビルドが `Cannot find native binding` で
失敗する。既存の lockfile を残したまま `npm install` / `npm audit fix` /
`npm i <pkg>@<ver>` で更新する。

### Cloudflare リソース（初回のみ）
```bash
cd backend
wrangler d1 create tomado-db                    # D1 データベース
wrangler kv namespace create KV                 # KV namespace
wrangler r2 bucket create tomado-replay-logs    # R2 バケット
wrangler secret put JWT_SECRET                  # JWT シークレット（リモート用）
```
各コマンドの出力にある ID を `backend/wrangler.jsonc` に反映する。

### ローカル開発用の設定
- `backend/.dev.vars` に `JWT_SECRET=<任意の値>` を設定（`.gitignore` 済み）
- ローカル D1 のマイグレーション適用:
  ```bash
  cd backend && npm run db:migrate
  ```

### PWA アイコン
`frontend/icons/` の PWA アイコンは、`frontend/assets/` の元画像から `@capacitor/assets` で
生成したもの。アイコンは描き直す予定（#104）で、生成の手順はそのときに決め直す。

## ローカル開発の起動

```bash
# ターミナル1: バックエンド（http://localhost:8787）
cd backend && npx wrangler dev

# ターミナル2: フロントエンド（http://localhost:5173）
cd frontend && npm run dev
```

フロントエンドは `frontend/.env.development` で API ベース URL を `http://localhost:8787` に設定済み。

## デプロイ

SPA と API は 1 つの Worker で配信する。本番は `--env production` でデプロイするので、Worker 名は
`vegtab-api-production`（dashboard で探すときはこの名前。`vegtab-api` は本番では使っていない）。SPA は Workers の Static Assets
（`backend/wrangler.jsonc` の `assets`、`frontend/dist`）で、`/api/*` `/s/*` だけが Worker のコードに回る。

```bash
# frontend build（vue-tsc → vite build）→ 本番 D1 マイグレーション → Worker デプロイ（--env production）
npm run deploy

# DBマイグレーションだけを適用する場合
npm run db:migrate:prod -w backend
```

`deploy` は未適用のマイグレーションを先に適用してから Worker をデプロイする。
マイグレーションを追加するときは、先に適用してもデプロイ前の Worker が壊れない形
（テーブル・カラムの追加など）にすること。削除や名前の変更は、コードの対応をデプロイした後の
別マイグレーションで行う。

## テスト

```bash
npm test                       # ルートで全パッケージのテスト実行
cd engine && npm test          # エンジンのみ
cd backend && npm test         # バックエンドのみ
```

## 開発ルール

### 全般
- TypeScript の strict モードを有効にすること
- テスト駆動で進めること。機能実装前にテストを書くか、実装と同時にテストを書く
- コミットは機能単位で細かく行う

### engine/
- UIやネットワークに一切依存しない純粋関数で構成する
- シード値を与えた場合に**完全に決定的な結果**を返すことを保証する
- 外部の乱数ライブラリは使わず、シード対応の擬似乱数生成器を自前実装する
- `frontend/` と `backend/` の双方から利用される

### backend/
- Hono フレームワークでルーティング
- 認証: JWT (jose) — アクセストークン(1h) + リフレッシュトークン(90d)
- テスト: `@cloudflare/vitest-plugin` で Workers 環境をエミュレート。D1 のスキーマは `migrations/` を `test/apply-migrations.ts` で当てる（テスト用のスキーマを別に書かない）
- `backend/.dev.vars` にローカル用シークレットを設定（Git 管理外）
- Workers の型は `wrangler types` で生成した `backend/worker-configuration.d.ts` を使う（`@cloudflare/workers-types` は使わない）。`wrangler.jsonc` を変えたら `npm run cf-typegen -w backend` で作り直す。`npm run typecheck -w backend` は生成した型が古ければ失敗する
- シークレット（`JWT_SECRET` など）は生成した型に入らないので、`src/types.ts` の `Bindings` に足す

### frontend/
- API クライアント (`frontend/src/api/client.ts`) が認証・リトライを一元管理
- optimistic local-first: localStorage をフォールバックとして維持しつつ API を呼ぶ
- API 失敗時もローカルデータで動作継続

### テスト
- フレームワーク: Vitest
- 各機能に正常系・境界値・エッジケースのテストを記述
- 特に「同一シード・同一操作で常に同一結果」の決定性テストを必須とする
- `npm test` (ルート) で全パッケージのテストが実行できるようにする

## 実装済み機能サマリー

**engine/:**
- Clear 専用（`GameMode` 型と `GameState.mode` は無い。`initializeGame(seed, params?)` が常におじゃまタイルを配置する）
- おじゃまタイル（シード配置で個数10〜20・耐久値1〜3、隣接マッチ/アイテム/スプーン直接タップでダメージ、非落下、消滅時に上タイル落下）
- スプーンバフ（周囲4マス消去 + 任意マス選択、連鎖時は周囲のみ、合成時追加消去）
- 重力はすり抜け落下だけ（おじゃまを固定して非おじゃまがすり抜けて下詰め）
- 最大連鎖数（`maxChainIndex`）を全てのゲームで記録する（連鎖の実績に使う）

**frontend/:**
- 野菜テーマ（5種類の野菜SVGアイコン）
- HOME の今日のパズルから直接プレイ開始（モード選択なし。過去日は案内を出してから開始）
- おじゃまタイル表示（SVG、耐久値数字+ひび割れ、2層テキスト描画）
- すり抜け落下のアニメーション
- ブランドカラー: 緑（`--brand: #2e7d32` / dark `#66bb6a`）
- トースト通知（エラー/成功/情報、自動消去+手動閉じ）
- オフラインキュー（スコア送信の自動リトライ）
- プレイ時間の計測と表示（`frontend/src/composables/usePlayTimer.ts`、累計は localStorage の `vegtab_play_time`）
- バックエンドスコア送信（ゲーム終了時に自動送信、オフラインキュー対応）
- 実績一覧ページ（`/achievements`）、解除時トースト通知
- フッターナビ（HOME / PUZZLE / 実績）、SVGアイコン
- アカウント引き継ぎUI（コード発行/入力、スコア同期）
- 手順再生ビューア（`/replay/:scoreId`）、ランキングからの導線
- チュートリアル（`/tutorial`）、18ステップ紙芝居形式、初回訪問プロンプト、設定メニュー導線
- ブラウザに残る撤去したモードのデータ（プレイ記録、途中経過、実績のキャッシュ、オフラインキューのスコア送信）は読み込まない（`frontend/src/lib/legacyData.ts`）

**backend/:**
- スコア送信・ランキング（API と D1 の `mode` は残し、`clear` だけを受け付ける。D1 に撤去したモードの行が残るので、照会は全て `mode = 'clear'` で絞る。行と列は #103 で捨てる）
- ベスト記録upsert（クリア優先+最少手数、同手数ならクリアまでの時間が短い方）
- OGP動的生成（Vege-Tableブランド、最少クリア手数、QRコード付きSVG）
- 実績解除判定（スコア送信時に自動評価 + クライアントトリガー。定義は `engine/src/achievements.ts` の `ACHIEVEMENT_DEFS` で、判定に使う値は各定義の `metric`。DB に残る撤去した実績は返さない）
- クライアント実績解除API（`POST /api/achievements/unlock`、ホワイトリスト制御）
- アカウント引き継ぎ（引き継ぎコード発行/入力、マルチデバイス対応）
- リプレイデータ取得API（R2からの操作ログ読み出し）

Phase ごとの実装履歴は `docs/SPEC.md` §7 と `git log` にある。現在の仕様は上の「実装済み機能サマリー」と下の「よくある注意点」に書く。

## よくある注意点
- 初期盤面の自動消去ではスコア0、アイテム生成なし
- マッチ判定は「縦横3直線」と「2×2正方形」の2種類がある
- 2×2は3直線と重複してもスプーン成立。4直線以上やL/T字5マス以上と重複した場合のみ上位優先
- スプーンのタップは1手消費。周囲4マス消去の後、任意1マス選択（手数消費なし）
- スプーンの連鎖発動時は周囲4マス消去のみ（ユーザー選択なし）
- スプーンの合成時は元の位置で周囲4マス消去が追加発動
- サラダボウル×おじゃまタイルのスワイプでは、盤上の全おじゃまタイルの耐久値を1減少させる（耐久値0で破壊）
- サラダボウル×サラダボウルの全消しではアイテムは誘爆せず残留し、その位置に留まる
- 食器セット×食器セットは周囲3マス（4マスではない）
- ハサミ(横)のアイコンは、ハサミ(縦)を90度回転させたもの
- アイテム表示名: scope=スプーン、v_cut=ハサミ(縦)、h_cut=ハサミ(横)、burst=食器セット、flush=サラダボウル
- アイテム生成は独立コンポーネント（色+位置で連結したマッチ群）ごとに1つ。1操作で複数の独立マッチが成立すれば複数アイテムが生成される
- コンポーネント内の優先順: サラダボウル > 食器セット > ハサミ = ハサミ > スプーン
- おじゃまタイルはスワイプで隣接タイルと入れ替え可能（マッチ不成立なら戻る）
- おじゃまタイルは落下しないが、消滅時に上のタイルは落下する
- ゲーム終了条件: 全おじゃまタイル除去（クリア） OR 詰み（失敗）。手数の上限はない
- スプーンでおじゃまタイルを直接タップすると耐久値を1減らせる
- 落下はすり抜け落下だけ（おじゃまを固定して非おじゃまがすり抜けて下詰め）
- スコア送信はベスト記録のみ保持（upsert）: クリア優先+最少手数、同手数ならクリアまでの時間が短い方
- ランキングはシードごとに存在し、クリアした記録だけを手数の少ない順（同手数なら時間の短い順。時間の記録がない行はその手数の最後）に並べる。スコアは表示だけで、順位には使わない。frontend と backend で同じ比較を持つ（`frontend/src/lib/bestResult.ts` と `backend/src/lib/ranking-rule.ts`。規則を変えるときは両方を直し、ランキングのキャッシュキーの版も上げる）
- クリアまでの時間は、seed ごとのその日の累計（リトライをまたぐ。アニメーション中とパズル画面を離れている間は数えない）。クライアントの自己申告で、サーバーでは検証しない
- engine の Clear の盤面計算（初期配置・落下・補充・連鎖・スコア）を変えると、記録済みのリプレイの再生と検証がずれる
- デイリーシードのみ。ユーザーによるシード生成・アンロック・お試しプレイは廃止
- TODO、スタミナ、アイテム持ち込み、Undoは全て廃止
