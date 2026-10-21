# CLAUDE.md

## プロジェクト概要
**Vege-Table** — デイリーパズル（3マッチ）で、おじゃまタイルを全て消すまでの手数を競うカジュアルゲーム。Wordleモデル。
モードは Clear だけ（Sprint / Survival / Cascade は #102 で撤去した）。
仕様の正本は `docs/SPEC.md`。ゲームルール、API、データ構造に関わる変更の前に、該当する節を読む。

※ 本番 URL `https://vegtab.kan-game.app`（kan-game.app のゲームの 1 つ。旧 URL `https://vegtab.app` は移転の案内と旧アカウントの引き継ぎだけを行う。`docs/SPEC.md` §5.4）

ID、名前、退会は kan-game.app の ID 基盤（kan/game、`~/game`）と共通。kan/game 側の変更（`ALLOWED_ORIGINS`、`GAME_VEGTAB`、プライバシーポリシーなど）が要るときは、**vegtab の作業から kan/game を編集しない。** 要る変更をまとめて、kan/game のセッションが動いていればそこへメッセージで、無ければ利用者に依頼する。

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
- #103 (kan-game.app への移行): `vegtab.kan-game.app` へ移り、独自の JWT と端末の登録を kan-game.app の ID に置き換えた。上の Phase のアカウント引き継ぎの記述は、現在の仕様ではない。#106（おじゃまの量の固定）も同時に入れた。

## 技術スタック
- **言語:** TypeScript (全パッケージ共通)
- **パッケージ管理:** npm workspaces
- **テスト:** Vitest
- **フロントエンド:** Vue.js (Composition API), Pinia, vue-i18n
- **バックエンド:** Cloudflare Workers (Hono), D1 (SQLite), KV, R2
- **認証:** kan-game.app の ID（ID 基盤が発行する Cookie の JWT を、Worker が公開鍵で検証する。`docs/SPEC.md` §5.1）

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

### 環境とリソース
環境はローカル（`wrangler.jsonc` の先頭）、開発（`env.dev`、`vegtab-dev.kan-game.app`）、本番（`env.production`、
`vegtab.kan-game.app` と旧 URL `vegtab.app`）の 3 つ。D1・KV・R2・VAPID の鍵・ID 基盤の公開鍵は環境ごとに別。
一覧は README「環境」。リモートのリソースの作成、secret の登録、デプロイは利用者の承認を得てから行う。

### ローカル開発用の設定
- ID 基盤（kan/game）を `../game`（または環境変数 `KAN_GAME_DIR`）に置き、kan/game 側で鍵の生成とローカル D1 の用意を
  済ませる（README「ローカルの ID 基盤」）。済んでいなければ `scripts/dev.mjs` は案内を出して止まる
- `backend/.dev.vars` は要らない。`scripts/dev.mjs` が `ID_PUBLIC_KEYS`、`ALLOWED_ORIGINS`、`FRONTEND_URL`、`JWT_SECRET` を
  `--var` で渡す。`.dev.vars` を置くと、その値が `wrangler types` に入って `npm run typecheck -w backend` が失敗する
- ローカル D1 のマイグレーション適用（初回と、マイグレーションを足した後）:
  ```bash
  cd backend && npm run db:migrate
  ```

### PWA アイコン
`frontend/icons/` の PWA アイコンは、`frontend/assets/` の元画像から `@capacitor/assets` で
生成したもの。アイコンは描き直す予定（#104）で、生成の手順はそのときに決め直す。

## ローカル開発の起動

ID 基盤（kan/game の `wrangler dev`）、backend（`wrangler dev`）、frontend（`vite`）は `scripts/dev.mjs` がまとめて起動する。

| コマンド | 用途 |
|---|---|
| `npm run dev:roji` | roji を通して起動する。`https://vegtab.<roji のドメイン>` で開ける |
| `npm run dev:all`（`npm run dev`） | roji なしで起動する。画面は `http://localhost:5173` |

- roji が使える環境では `npm run dev:roji` で起動する。**その環境では `npm run dev:all`、`npm run dev`、`vite` や
  `wrangler dev` の直接の実行で起動しない。** ポートを固定すると、ほかのプロジェクトの開発サーバーと衝突するため
  - roji が使えるかは、`command -v roji` が成功し、`roji health` が「正常」を返すことで確かめる
  - 開く URL は、起動時に出る `roji: https://... -> localhost:<ポート>` の行か `roji routes` で確かめる。roji のドメインは
    環境ごとに違うので決め打ちしない
- roji が使えない環境では `npm run dev:all` を使う。画面のポートは 5173 に固定で、使用中なら起動に失敗する
- ID 基盤と backend のポートは起動のたびに空いているものを選ぶ。Vite は `/api` と `/s/` を backend へ転送し
  （`frontend/vite.config.ts`、ポートは環境変数 `VEGTAB_API_PORT`）、backend の `ID` binding は wrangler の dev registry で
  ID 基盤につながる。ポートを決め打ちしない
- roji 経由では画面とポータル（`localhost`）のホストが違い、ID の Cookie を共有しない。ポータル（復旧コード、退会）を
  通して確かめるときは `npm run dev:all` で起動する
- 終了は `Ctrl+C`。3 つとも止まり、roji のルートも取り消される

## デプロイ

SPA と API は 1 つの Worker で配信する。本番は `--env production` でデプロイするので、Worker 名は
`vegtab-api-production`（dashboard で探すときはこの名前。`vegtab-api` は本番では使っていない）。SPA は Workers の Static Assets
（`backend/wrangler.jsonc` の `assets`、`frontend/dist`）で、`/api/*` `/s/*` だけが Worker のコードに回る。

```bash
# frontend build（vue-tsc → vite build）→ 本番 D1 マイグレーション → Worker デプロイ（--env production）
npm run deploy

# DBマイグレーションだけを適用する場合
npm run db:migrate:prod -w backend

# 開発環境（vegtab-dev.kan-game.app）: frontend build の後に
npm run deploy:dev -w backend
```

kan/game と vegtab は互いを Service Binding で指す。新しい環境では vegtab の Worker（`GameService` を持つ）を先に出し、
kan/game に `GAME_VEGTAB` を足すのはその後にする（先の Worker が無いと kan/game の退会が毎回失敗する）。

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
- 認証: kan-game.app の ID の Cookie を `src/lib/id-auth.ts` で検証し、`userId` に入れる（`src/middleware/auth.ts`）。`/api/id/*` は ID 基盤へそのまま中継する
  - **`src/lib/id-token.ts`、`src/lib/id-rpc.ts`、`test/kan-game/` のファイルは書き換えない。** kan/game の `src/token.ts`、`src/rpc.ts`、`testing/`、`test-vectors/id-token.json` の写しで、kan/game が更新したら写し直す（今の写しは kan/game の `258c299`）
  - 状態を変える API は `Origin` が `ALLOWED_ORIGINS` に含まれることを必須にする（ミドルウェアが確かめる）
  - 名前は ID 基盤の `registerName`（RPC）で登録し、`profiles` に写す。名前の規則を vegtab で持たない
  - 記録を持つテーブルを足したら、退会（`src/lib/account.ts` の `ACCOUNT_TABLES`）にも足す
- 旧 URL（`vegtab.app`）の旧アカウントのための JWT（`src/lib/jwt.ts`、`refresh-tokens.ts`、`routes/auth.ts`、`routes/legacy.ts`）は、移転の案内と引き継ぎにだけ使う。新しい機能で使わない
- テスト: `@cloudflare/vitest-plugin` で Workers 環境をエミュレート。D1 のスキーマは `migrations/` を `test/apply-migrations.ts` で当てる（テスト用のスキーマを別に書かない）
  - API は `test/helpers.ts` の `call` で呼ぶ（`SELF.fetch` は使わない）。ID 基盤の偽物（`idPlatform`）とテスト用の鍵で動かすため。`registerUser({ name })` で名前と同意のある ID を作る
- Workers の型は `wrangler types` で生成した `backend/worker-configuration.d.ts` を使う（`@cloudflare/workers-types` は使わない）。`wrangler.jsonc` を変えたら `npm run cf-typegen -w backend` で作り直す。`npm run typecheck -w backend` は生成した型が古ければ失敗する。型は `backend/.dev.vars` が無い状態で生成する（あると、その値が型に入って食い違う）
- シークレット（`JWT_SECRET` など）は生成した型に入らないので、`src/types.ts` の `Bindings` に足す

### frontend/
- kan-game.app の ID の状態（発行、延長、`401` / `410` からの回復、引き継ぎコード、ポータルの URL）は `frontend/src/api/id.ts` に集める。ID が変わると、ストアは `onIdChange` で中身を入れ替える
- API クライアント (`frontend/src/api/client.ts`) が API の呼び出しとオフラインのリトライを一元管理する。API は同一オリジンの相対パスで呼ぶ（Cookie を付けるため）
- 旧 URL（`vegtab.app`）では、ゲームの代わりに移転の案内（`frontend/src/legacy/`）を出す
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
- おじゃまタイル（どの日も 16 個・耐久値は 1 が 6 個、2 が 8 個、3 が 2 個で、位置と割り当てはシードから決める（#106）。隣接マッチ/アイテム/スプーン直接タップでダメージ、非落下、消滅時に上タイル落下）
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
- kan-game.app の ID（引き継ぎコードの発行/入力、名前と公開の同意のダイアログ、ポータルへの導線）、旧 URL からの引き継ぎの確認（`#handoff=`）
- 手順再生ビューア（`/replay/:scoreId`）、ランキングからの導線
- チュートリアル（`/tutorial`）、18ステップ紙芝居形式、初回訪問プロンプト、設定メニュー導線
- ブラウザに残る撤去したモードのデータ（プレイ記録、途中経過、実績のキャッシュ、オフラインキューのスコア送信）は読み込まない（`frontend/src/lib/legacyData.ts`）

**backend/:**
- スコア送信・ランキング（API と D1 の `mode` は残し、`clear` だけを受け付ける。照会は全て `mode = 'clear'` で絞る。撤去したモードの行はマイグレーション 0014 で捨てた。列は後で捨てる）。ランキングに載るのは名前と同意（`profiles`）のある ID と、引き継がれていない旧アカウント
- ベスト記録upsert（クリア優先+最少手数、同手数ならクリアまでの時間が短い方）
- OGP動的生成（Vege-Tableブランド、最少クリア手数、QRコード付きSVG）
- 実績解除判定（スコア送信時に自動評価 + クライアントトリガー。定義は `engine/src/achievements.ts` の `ACHIEVEMENT_DEFS` で、判定に使う値は各定義の `metric`。DB に残る撤去した実績は返さない）
- クライアント実績解除API（`POST /api/achievements/unlock`、ホワイトリスト制御）
- kan-game.app の ID の検証と `/api/id/*` の中継、名前の登録（`registerName`）、退会（`GameService.deleteAccount`）
- 旧 URL の旧アカウントの引き継ぎ（`/api/legacy/handoff` と `/api/legacy/claim`。`docs/SPEC.md` §5.4）
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
