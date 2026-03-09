# CLAUDE.md

## プロジェクト概要
デイリーパズル（3マッチ）でスコアを競うカジュアルゲーム。Wordleモデル。
詳細な仕様は `docs/SPEC.md` を必ず参照すること。

※ プロジェクト名・ゲーム名は仮称。正式名称は別途決定する。旧称「Project Tomado」からピボット中。
※ 旧α版 `https://3tomado.app` はピボット前の実装。

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
- Phase 1 (Core Engine): 基本実装済み。ピボット対応（3モード・おじゃまタイル・虫めがねバフ）が必要。
- Phase 2 (Frontend UI): 基本実装済み。ピボット対応（TODO削除・野菜テーマ・モード選択UI等）が必要。
- Phase 3 (Backend API): 基本実装済み。ピボット対応（TODO/スタミナ関連API削除・モード対応）が必要。
- **現在の対象: 全Phase のピボット対応（ステップ1: 削除 → ステップ2: 追加）**

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

## ピボット対応: 直近のタスク

大規模なピボットを **2ステップ** に分けて実施する。詳細は `docs/SPEC.md` を参照。

### ステップ1: 削除（先に実施）

以下の廃止機能に関連するコード・テストを全て削除し、テストが通る状態にする。

**削除対象:**
- TODO管理機能の全体（UI、ストア、APIルート、DBテーブル `todo_groups` `todos` `daily_todo_progress`）
- スタミナシステム（UI、ストア、APIルート、DBテーブル `stamina_recovery_logs`、`users`テーブルの `stamina` `last_stamina_recover_at` カラム）
- アイテム持ち込み機能（UI、ストア、APIルート、DBテーブル `user_items`、`play_scores`の`used_brought_items`カラム）
- Undoチケット機能（UI、ストア、APIルート、`users`テーブルの `undo_stock` カラム、`play_scores`の`used_undo`カラム）
- ユーザーによるシード生成（New Puzzle フロー）
- シードのアンロック・お試しプレイの仕組み（DBテーブル `user_unlocked_seeds`、`play_scores`の`is_trial`カラム）
- フリーモード（LIMITED→CONTINUE の2段階フロー。エンジンの free モード対応）
- `users`テーブルの `is_premium` カラム
- DBテーブル `achievement_milestones`（報酬なしトロフィーに変更のため）

### ステップ2: 追加（削除完了後に実施）

**engine/ への追加・変更:**
1. **3つのゲームモード対応:** Sprint（15手ハイスコア）、Clear（おじゃまタイル除去）、Survival（スコアノルママラソン）
2. **おじゃまタイル:** シード値による配置生成、耐久値（1〜3）管理、隣接マッチ/アイテム範囲で耐久値減少、落下しない、消滅時に上タイル落下
3. **虫めがねバフ:** タップ/合成起動時に周囲縦横4マス消去を追加。連鎖発動時は周囲4マスのみ（ユーザー選択なし）。合成時も元の位置で周囲4マス追加消去
4. **Survivalモード:** 5手ごとのスコアノルマ判定（段階的に重くなる）
5. **ゲーム終了判定の3モード対応**
6. 上記全てに対するテスト追加

**frontend/ への変更:**
1. **野菜テーマ適用:** タイルを5種類の野菜アイコンに変更。色+シルエットで区別
2. **モード選択UI:** Sprint / Clear / Survival（HOME画面またはパズル開始時）
3. **おじゃまタイル表示:** 耐久値の視覚表現（数字 or ひび割れ等）
4. **Survivalノルマ表示:** 現在のノルマと達成状況のゲージ等
5. **虫めがね選択UI:** タップ起動後の周囲4マス消去エフェクト + 任意マス選択
6. **HOMEダッシュボード簡素化:** デイリーシードへのショートカット、Sprintランキングプレビュー、カレンダーUI（TODO関連を削除）
7. **シンプルなシェアUI:** スコア+ボード状態のSNSシェア（既存の共有機能を簡素化）

**backend/ への変更:**
1. TODO/スタミナ/アイテム/Undo関連APIルートの削除
2. シード生成/アンロック/お試しプレイ関連APIの削除
3. DBマイグレーション（テーブル・カラム削除、`mode`カラムの値を sprint/clear/survival に変更）
4. ランキングAPIのモード対応（sprint/clear/survival）
5. スコア送信APIのモード対応

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
- ランキングはシード×モードごとに存在し、Sprintがメイン
- デイリーシードのみ。ユーザーによるシード生成・アンロック・お試しプレイは廃止
- TODO、スタミナ、アイテム持ち込み、Undoは全て廃止
