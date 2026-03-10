# CLAUDE.md

## プロジェクト概要
**Vege-Table** — デイリーパズル（3マッチ）でスコアを競うカジュアルゲーム。Wordleモデル。
詳細な仕様は `docs/SPEC.md` を必ず参照すること。

※ 旧称「Project Tomado」からピボット完了。ゲーム名は **Vege-Table**。
※ 本番URL `https://3tomado.app`（ドメイン名は旧称のまま）。

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
- Phase 1 (Core Engine): 完了。3モード・おじゃまタイル・虫めがねバフ・Survivalノルマ実装済み。
- Phase 2 (Frontend UI): 完了。野菜テーマ・モード選択UI・おじゃまタイル表示・Survivalゲージ実装済み。
- Phase 3 (Backend API): 完了。モード対応・ベストスコアupsert・ランキング実装済み。
- Phase 3.5 (Pre-release): 完了。α版公開済み。シェア・i18n・ダークモード・SE/BGM。
- **Phase 3.7 (UXポリッシュ & 機能追加): 現在の対象。** 詳細は `docs/SPEC.md` §7 Phase 3.7 を参照。
- Phase 4 (Native & Monetization): 将来検討。

## 技術スタック
- **言語:** TypeScript (全パッケージ共通)
- **パッケージ管理:** npm workspaces
- **テスト:** Vitest
- **フロントエンド:** Vue.js (Composition API), Pinia, VueUse, vue-i18n
- **バックエンド:** Cloudflare Workers (Hono), D1 (SQLite), KV, R2
- **認証:** JWT (jose) — アクセストークン(1h) + リフレッシュトークン(90d)

## 環境セットアップ

### 初回セットアップ
```bash
npm install                    # ルートで全 workspace の依存をインストール
```

### Cloudflare リソース（初回のみ）
```bash
cd backend
wrangler d1 create tomado-db                    # D1 データベース
wrangler kv namespace create KV                 # KV namespace
wrangler r2 bucket create tomado-replay-logs    # R2 バケット
wrangler secret put JWT_SECRET                  # JWT シークレット（リモート用）
```
各コマンドの出力にある ID を `backend/wrangler.toml` に反映する。

### ローカル開発用の設定
- `backend/.dev.vars` に `JWT_SECRET=<任意の値>` を設定（`.gitignore` 済み）
- ローカル D1 のマイグレーション適用:
  ```bash
  cd backend && npx wrangler d1 migrations apply tomado-db --local
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

```bash
# 全体デプロイ（バックエンド → フロントエンド）
npm run deploy

# 個別デプロイ
npm run deploy:backend    # Workers API (--env production)
npm run deploy:frontend   # Pages SPA (vue-tsc → vite build → pages deploy)

# DBマイグレーション（新しいマイグレーション追加時、デプロイ前に実行）
npm run db:migrate:prod -w backend
```

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
- テスト: `@cloudflare/vitest-pool-workers` で Workers 環境をエミュレート
- `backend/.dev.vars` にローカル用シークレットを設定（Git 管理外）

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
- 3モード対応（Sprint / Clear / Survival）
- おじゃまタイル（シード配置、耐久値1〜3、隣接マッチ/アイテム/スプーン直接タップでダメージ、非落下、消滅時に上タイル落下）
- 虫めがねバフ（周囲4マス消去 + 任意マス選択、連鎖時は周囲のみ、合成時追加消去）
- Survivalノルマ（5手ごと区間スコア判定、段階的に上昇）
- セグメントベース重力（おじゃまタイルがバリアとして機能）

**frontend/:**
- 野菜テーマ（5種類の野菜SVGアイコン）
- モード選択UI（パズル画面遷移時にモーダル表示）
- おじゃまタイル表示（SVG、耐久値数字+ひび割れ、2層テキスト描画）
- Survivalゲージ（区間残りポイント + 進捗バー）
- セグメントベースの落下アニメーション
- ブランドカラー: 緑（`--brand: #2e7d32` / dark `#66bb6a`）
- トースト通知（エラー/成功/情報、自動消去+手動閉じ）
- オフラインキュー（スコア送信の自動リトライ）
- バックエンドスコア送信（ゲーム終了時に自動送信、オフラインキュー対応）

**backend/:**
- モード対応スコア送信・ランキング
- ベストスコアupsert（Sprint: 最高スコア、Clear: クリア優先+最少手数、Survival: 最多手数）
- OGP動的生成（Vege-Tableブランド、モード別スコア、QRコード付きSVG）

## Phase 3.7 実装計画

フィールドテストを経たUX改善と機能追加。優先度順に実装する。

### 高優先度
1. **実績（トロフィー）システム** — `achievements` テーブル（既存）を使用。スコア送信時に自動判定。実績一覧画面・解除通知を実装。
2. ~~**エラー状態メッセージング**~~ ✅ — ToastContainer コンポーネント + API client統合。ネットワーク/認証/送信エラーを種別ごとにトースト通知。i18n対応（ja/en 7キー）。
3. **アカウント引き継ぎ** — 引き継ぎコード（8文字、KV TTL 10分）で複数デバイスを同一ユーザーに紐付け。`user_devices` テーブル追加。将来のOAuth連携の基盤。
4. ~~**ユーザー名入力プロンプト**~~ ✅ — ゲーム終了時にdisplay_name未設定なら名前入力モーダル表示。スキップ可。
5. ~~**Sprint残り手数の強調**~~ ✅ — 大型カウンター、残り5手で警告色+パルスボーダー、残り5手/3手以下でオーバーレイ表示。

### 中優先度
6. ~~**HOME画面ランキング直接表示**~~ ✅ — デイリーカード内にモード切替タブ付きTOP5ランキング表示。ベストスコア重複排除。
7. ~~**スプーンタップ案内**~~ ✅ — スプーンタップ・合成時に効果別ヒントをツールチップ表示（4種類のヒントメッセージ）。
8. ~~**おじゃまダメージフィードバック**~~ ✅ — 耐久値減少時の揺れアニメーション、破壊時エフェクト。
9. ~~**OGP画像生成**~~ ✅ — Vege-Tableブランディング適用、モード別ベストスコア表示（Sprint/Clear/Survival）、動的SVG+QRコード。
10. ~~**オフラインリトライ**~~ ✅ — localStorageキュー（24h有効、最大3回リトライ）、onlineイベント+起動時に自動フラッシュ。スコア送信で利用。

### 低優先度
11. ~~**Survivalゲージアニメーション**~~ ✅ — ノルマ達成率80%以上でパルス、100%で「ノルマ達成！」表示。
12. **デイリーシードカウントダウン** — HOME画面にUTC 0時までの残り時間タイマー。
13. ~~**ゲーム終了モーダルのボタンアイコン**~~ ✅ — リトライ(↻)/シェア(共有アイコンSVG)/HOME(⌂)のモノトーンアイコン。
14. ~~**デイリーパズルのヘルプ説明**~~ ✅ — HOME画面に?ボタン、全員同じ盤面であることをトグル表示。

## よくある注意点
- 初期盤面の自動消去ではスコア0、アイテム生成なし
- マッチ判定は「縦横3直線」と「2×2正方形」の2種類がある
- 2×2は3直線と重複しても虫めがね成立。4直線以上やL/T字5マス以上と重複した場合のみ上位優先
- 虫めがねのタップは1手消費。周囲4マス消去の後、任意1マス選択（手数消費なし）
- 虫めがねの連鎖発動時は周囲4マス消去のみ（ユーザー選択なし）
- 虫めがねの合成時は元の位置で周囲4マス消去が追加発動
- コーヒー×コーヒーの全消しではアイテムは誘爆せず残留し、その位置に留まる
- クリップ×クリップは周囲3マス（4マスではない）
- カッターアイコンは、はさみを90度回転させたもの（縦=はさみ、横=カッター）
- Sprint終了時、盤上の残存アイテムにボーナス加算（虫めがね50/はさみ・カッター150/クリップ300/コーヒー500）
- アイテム生成の優先順: コーヒーカップ > クリップ > カッター = はさみ > 虫めがね
- おじゃまタイルは落下しないが、消滅時に上のタイルは落下する
- ゲーム終了条件はモードにより異なる:
  - Sprint: 規定手数（暫定15手）到達 OR 詰み
  - Clear: 全おじゃまタイル除去（クリア） OR 詰み（失敗）
  - Survival: ノルマ未達（ゲームオーバー） OR 詰み
- Survivalノルマは区間スコア制: 各5手区間で独立して判定、得点は引き継がない
- スプーン（虫めがね）でおじゃまタイルを直接タップすると耐久値を1減らせる
- おじゃまタイルはセグメントバリアとして機能: 落下は同列内のおじゃまタイル間でのみ発生
- スコア送信はベストスコアのみ保持（upsert）: Sprint=最高スコア、Clear=クリア優先+最少手数、Survival=最多手数
- ランキングはシード×モードごとに存在し、Sprintがメイン
- デイリーシードのみ。ユーザーによるシード生成・アンロック・お試しプレイは廃止
- TODO、スタミナ、アイテム持ち込み、Undoは全て廃止
