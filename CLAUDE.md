# CLAUDE.md

## プロジェクト概要
Project Tomado: TODO管理 × 3マッチパズルのゲーミフィケーションアプリ。
詳細な仕様は `docs/SPEC.md` を必ず参照すること。

## リポジトリ構成
```
tomado/
├── engine/             # パズルエンジン（純粋TypeScript、フレームワーク非依存）
├── frontend/           # Vue.js SPA
├── backend/            # Cloudflare Workers API
├── docs/
│   └── SPEC.md         # 全仕様書
├── package.json        # npm workspaces
└── CLAUDE.md           # このファイル
```

## 開発フェーズ
Phase 1 → 2 → 3 → 3.5 → 4 の順で段階的に実装する。各Phaseの詳細は `docs/SPEC.md` §8 を参照。
- Phase 1 (Core Engine): 完了
- Phase 2 (Frontend UI): 完了
- Phase 3 (Backend API): 完了（API実装・フロントエンド接続済み）
- **現在の対象: Phase 3.5 (プレリリース準備)** — 共有URL完成・α版表示・i18n・ダークモード・エフェクト・デプロイ
- Phase 4 (Native & Monetization): 未着手

## 技術スタック
- **言語:** TypeScript (全パッケージ共通)
- **パッケージ管理:** npm workspaces
- **テスト:** Vitest
- **フロントエンド:** Vue.js (Composition API), Pinia, VueUse
- **バックエンド:** Cloudflare Workers (Hono), D1 (SQLite), KV, R2
- **ネイティブ (Phase 4):** Capacitor

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

## リモートデプロイ

```bash
# D1 マイグレーション（新しいマイグレーション追加時）
cd backend && npx wrangler d1 migrations apply tomado-db --remote

# Workers デプロイ
cd backend && npx wrangler deploy
```

## テスト

```bash
npm test                       # ルートで全パッケージのテスト実行
cd engine && npm test          # エンジンのみ（78テスト）
cd backend && npm test         # バックエンドのみ（15テスト）
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

## Phase 3 実装状況: 完了

- Cloudflare Workers プロジェクトセットアップ（Wrangler, D1, KV, R2）
- D1 マイグレーション（11テーブル）、認証・ユーザー・TODO・グループ・シード・スコア・ランキング・日次進捗・共有URL の全API
- フロントエンド API クライアント層、stores の API 接続（game.ts, todo.ts）
- テスト: 15テスト（auth, todos, seeds）

### Phase 3 残件（Phase 3.5 で対応）
- リプレイ検証（エンジンを使ったサーバーサイド再計算）
- レートリミットミドルウェア
- フロントエンドテスト

## Phase 3.5 実装計画（プレリリース準備）

### Step 1: 共有URL完成
- [ ] フロントエンド共有ボタン — Web Share API + クリップボードコピー
- [ ] `/s/:code` ルート — shareCode → seedId 解決 → `/puzzle/:seed` リダイレクト
- [ ] QRコード表示 — スコア画面・シード詳細
- [ ] OGP改善 — og:image 追加

### Step 2: α版バナー
- [ ] HOME上部にα版バナー表示
- [ ] アプリバージョン表示

### Step 3: i18n
- [ ] vue-i18n セットアップ + locale自動検出
- [ ] 英語/日本語リソースファイル作成（200+文字列）
- [ ] 全画面のテキストを `$t()` に置換（HomeView, PuzzleView, TodoView, BottomNav, RankingModal, constants）
- [ ] 言語切替UI

### Step 4: ダークモード
- [ ] CSS Custom Properties でテーマ色定義（theme.css）
- [ ] テーマ状態管理（useTheme composable, localStorage永続化, prefers-color-scheme検出）
- [ ] 全コンポーネント（9ファイル、120+箇所）の色を CSS変数に置換
- [ ] 付箋5色のダークバリアント
- [ ] テーマ切替UI

### Step 5: エフェクト・サウンド・バイブレーション
- [ ] サウンドマネージャ（Web Audio API）
- [ ] SE 8種 + BGM（素材準備が必要）
- [ ] バイブレーション（navigator.vibrate）
- [ ] エフェクト調整（スクリーンシェイク、パーティクル）
- [ ] サウンド・振動設定UI

### Step 6: デプロイ
- [ ] フロントエンド本番ビルド + Cloudflare Pages デプロイ
- [ ] バックエンド本番 Workers デプロイ + D1マイグレーション
- [ ] CORS本番ドメイン制限
- [ ] 環境変数（VITE_API_BASE）設定

### Step 7: リリース確認
- [ ] E2Eスモークテスト
- [ ] 共有URL/OGP確認
- [ ] モバイルブラウザテスト
- [ ] ダークモード・日本語表示確認

## よくある注意点
- 初期盤面の自動消去ではスコア0、アイテム生成なし
- マッチ判定は「縦横3直線」と「2×2正方形」の2種類がある
- 2×2は3直線と重複しても虫めがね成立。4直線以上やL/T字5マス以上と重複した場合のみ上位優先
- 虫めがねのタップは1手消費するが、その後のマス選択は手数消費なし
- コーヒー×コーヒーの全消しではアイテムは誘爆せず残留し、その位置に留まる
- クリップ×クリップは周囲3マス（4マスではない）
- 手数制限モード終了時、盤上の残存アイテムにボーナス加算（虫めがね50/はさみ・カッター150/クリップ300/コーヒー500）
- アイテム生成の優先順: コーヒーカップ > クリップ > カッター = はさみ > 虫めがね
- ゲーム開始は常にLIMITEDモード（規定手数: 暫定15手）
- LIMITED手数消化後、スコア確定 → FREEモードとして継続プレイ可能
- フリーモード終了: 有効なスワイプなし AND アイテムなし
- 手数制限モードのUndoは手数カウントも1戻す
- カッターアイコンは、はさみを90度回転させたもの（縦=はさみ、横=カッター）
- ランキングはシード×モードごとに存在し、手数制限がメイン、フリーがサブ
