# CLAUDE.md

## プロジェクト概要
**Vege-Table** — デイリーパズル（3マッチ）でスコアを競うカジュアルゲーム。Wordleモデル。
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
Phase 1 → 2 → 3 → 4 の順で段階的に実装する。各Phaseの詳細は `docs/SPEC.md` §7 を参照。
- Phase 1 (Core Engine): 完了。3モード・おじゃまタイル・スプーンバフ・Survivalウェーブ制侵食実装済み。
- Phase 2 (Frontend UI): 完了。野菜テーマ・モード選択UI・おじゃまタイル表示・Survivalウェーブ表示実装済み。
- Phase 3 (Backend API): 完了。モード対応・ベストスコアupsert・ランキング実装済み。
- Phase 3.5 (Pre-release): 完了。α版公開済み。シェア・i18n・ダークモード・SE/BGM。
- Phase 3.7 (UXポリッシュ & 機能追加): 完了。実績システム・アカウント引き継ぎ・各種UX改善。
- Phase 3.8 (手順再生 & スコア送信修正): 完了。リプレイビューア・カレンダースコア送信・未送信スコア再送。
- Phase 3.9 (チュートリアル): 完了。21ステップ紙芝居チュートリアル・準備完了実績・アイテム名リネーム。
- Phase 3.11 (Cascade改善Phase1): 完了。連鎖ポテンシャル表示・連鎖メーター・マイルストーンボーナス・NEW BEST演出。
- Phase 3.12 (Cascade改善Phase2): 完了。キラキラ野菜（初期配置+補充+キラキラCP加算+ネクスト表示反映）。
- Phase 4 (Native & Monetization): Capacitor の Android / iOS プロジェクト（`frontend/android` `frontend/ios`）と CI ビルドは導入済み。課金は将来検討。

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
作り直すと macOS ランナーの iOS ビルドが `Cannot find native binding` で
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

### アプリアイコン・スプラッシュの再生成
`frontend/assets/` の元画像から Android / iOS 用リソースを生成する。
`@capacitor/assets`（アプリアイコン）と `sharp-cli`（PWA アイコン）は依存ツリーに
脆弱性を持ち込むわりに手動実行しかしないため devDependencies には入れず、
必要なときだけ `npx` で実行する。

```bash
cd frontend && npx @capacitor/assets generate
```

## ローカル開発の起動

```bash
# ターミナル1: バックエンド（http://localhost:8787）
cd backend && npx wrangler dev

# ターミナル2: フロントエンド（http://localhost:5173）
cd frontend && npm run dev
```

フロントエンドは `frontend/.env.development` で API ベース URL を `http://localhost:8787` に設定済み。

## デプロイ

SPA と API は 1 つの Worker（`vegtab-api`）で配信する。SPA は Workers の Static Assets
（`backend/wrangler.jsonc` の `assets`、`frontend/dist`）で、`/api/*` `/s/*` `/download/*` だけが Worker のコードに回る。

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
- 4モード対応（Sprint / Clear / Survival / Cascade）
- Cascade: CPスコアリング（chainIndex≥2の累積）、ネクスト表示（peekNextTiles）、連鎖マイルストーンボーナス（3連鎖+10/5連鎖+25/7連鎖+50 CP）、連鎖ポテンシャル表示、連鎖メーター、NEW BEST演出、キラキラ野菜（初期2個+補充10%、消去時+1 CP/個）
- おじゃまタイル（Clear: シード配置で耐久値1〜3 / Survival: ウェーブ侵食で耐久値1〜4、隣接マッチ/アイテム/スプーン直接タップでダメージ、非落下、消滅時に上タイル落下）
- スプーンバフ（周囲4マス消去 + 任意マス選択、連鎖時は周囲のみ、合成時追加消去）
- Survivalウェーブ制侵食（3ターン間隔、侵食個数 12→16→20 で頭打ち、シード×ウェーブ番号で決定論的位置算出、2ターン前から予告、アイテム強制発動、耐久値4到達で即死）
- セグメントベース重力（Sprint/Cascade: おじゃまなし or 落下しないバリア / Clear/Survival: おじゃまを固定して非おじゃまがすり抜け落下）

**frontend/:**
- 野菜テーマ（5種類の野菜SVGアイコン）
- モード選択UI（パズル画面遷移時にモーダル表示）
- おじゃまタイル表示（SVG、耐久値数字+ひび割れ、2層テキスト描画）
- Survivalウェーブ情報表示（現在ウェーブ番号 + 次ウェーブまでの残ターン + 盤面上の侵食予告マーカー）
- セグメントベースの落下アニメーション
- ブランドカラー: 緑（`--brand: #2e7d32` / dark `#66bb6a`）
- トースト通知（エラー/成功/情報、自動消去+手動閉じ）
- オフラインキュー（スコア送信の自動リトライ）
- バックエンドスコア送信（ゲーム終了時に自動送信、オフラインキュー対応）
- 実績一覧ページ（`/achievements`）、解除時トースト通知
- フッターナビ（HOME / PUZZLE / 実績）、SVGアイコン
- アカウント引き継ぎUI（コード発行/入力、スコア同期）
- 手順再生ビューア（`/replay/:scoreId`）、ランキングからの導線
- チュートリアル（`/tutorial`）、21ステップ紙芝居形式、初回訪問プロンプト、設定メニュー導線

**backend/:**
- モード対応スコア送信・ランキング
- ベストスコアupsert（Sprint: 最高スコア、Clear: クリア優先+最少手数、Survival: 最多手数、Cascade: 最高CP）
- OGP動的生成（Vege-Tableブランド、モード別スコア、QRコード付きSVG）
- 実績解除判定（スコア送信時に自動評価 + クライアントトリガー、全25種の実績定義）
- クライアント実績解除API（`POST /api/achievements/unlock`、ホワイトリスト制御）
- アカウント引き継ぎ（引き継ぎコード発行/入力、マルチデバイス対応）
- リプレイデータ取得API（R2からの操作ログ読み出し）

## 残課題

- `frontend/public/tutorial/survival.png` は旧UI（ノルマゲージ）のスクリーンショット。新UI（ウェーブ情報表示 + 予告マーカー）に撮り直す必要がある

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
- Sprint終了時、盤上の残存アイテムを1つずつ自動発動し、効果（誘爆を含む）で消えたタイルの点だけを加算する。アイテムごとの固定ボーナスはない。落下後のマッチは連鎖として処理しない
- アイテム表示名: scope=スプーン、v_cut=ハサミ(縦)、h_cut=ハサミ(横)、burst=食器セット、flush=サラダボウル
- アイテム生成は独立コンポーネント（色+位置で連結したマッチ群）ごとに1つ。1操作で複数の独立マッチが成立すれば複数アイテムが生成される
- コンポーネント内の優先順: サラダボウル > 食器セット > ハサミ = ハサミ > スプーン
- おじゃまタイルはスワイプで隣接タイルと入れ替え可能（マッチ不成立なら戻る）
- おじゃまタイルは落下しないが、消滅時に上のタイルは落下する
- ゲーム終了条件はモードにより異なる:
  - Sprint: 規定手数（暫定15手）到達 OR 詰み
  - Clear: 全おじゃまタイル除去（クリア） OR 詰み（失敗）
  - Survival: おじゃまタイル耐久値4到達（即死） OR 詰み
  - Cascade: 規定手数（15手）到達 OR 詰み（4色・おじゃまなし・ネクスト表示あり・CPスコアリング）
- Survivalはウェーブ制: 3ターンごとに侵食が発生し、シード×ウェーブ番号から決定論的に算出された位置におじゃまタイル（耐久値1）を設置する。既存おじゃまに再侵食した場合は耐久値+1（最大4で即ゲームオーバー）
- Survival侵食は2フェーズ: (1)全位置にまずおじゃまを配置（アイテム位置も含む）、(2)アイテムの強制発動。発動したアイテム位置のおじゃまは消滅扱い（再設置しない）
- Survival予告表示: 次のウェーブの2ターン前から侵食予定位置を盤面上にマーカー表示
- スプーンでおじゃまタイルを直接タップすると耐久値を1減らせる
- おじゃまタイル時の落下挙動はモードによって異なる: Clear/Survival は `passThroughObstacles=true`（おじゃまを固定して非おじゃまがすり抜け落下）、Sprint/Cascade はセグメントバリア（落下は同列内のおじゃまタイル間でのみ発生）
- スコア送信はベストスコアのみ保持（upsert）: Sprint=最高スコア、Clear=クリア優先+最少手数、Survival=最多手数、Cascade=最高CP（同CPならスコアが高い方）
- ランキングはシード×モードごとに存在し、Sprintがメイン
- デイリーシードのみ。ユーザーによるシード生成・アンロック・お試しプレイは廃止
- TODO、スタミナ、アイテム持ち込み、Undoは全て廃止
