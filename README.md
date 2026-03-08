# Project Tomado

TODO管理 × 3マッチパズルのゲーミフィケーションアプリ。
TODOを消化してスタミナやアイテムを獲得し、シード固定のパズルでハイスコアを競う。

## 構成

| パッケージ | 技術 | 説明 |
|---|---|---|
| `engine/` | TypeScript | パズルエンジン。純粋関数、フレームワーク非依存。シード値による決定的な盤面生成・マッチ判定・連鎖処理・アイテム・スコア計算 |
| `frontend/` | Vue.js, Pinia | SPA。パズル画面・TODO管理・HOMEダッシュボード |
| `backend/` | Cloudflare Workers, Hono | REST API。認証・TODO・シード・ランキング・スコア管理 |

モノレポ構成（npm workspaces）。`engine/` は `frontend/` と `backend/` 双方から利用される。

## セットアップ

### 前提
- Node.js 18+
- Cloudflare アカウント（バックエンド用）
- Wrangler CLI（`npx wrangler` で利用可能）

### インストール

```bash
git clone <repo-url> && cd tomado
npm install
```

### Cloudflare リソース作成（初回のみ）

```bash
cd backend

# D1 データベース
wrangler d1 create tomado-db
# → 出力の database_id を wrangler.toml に反映

# KV namespace
wrangler kv namespace create KV
# → 出力の id を wrangler.toml に反映

# R2 バケット（リプレイログ保存用）
wrangler r2 bucket create tomado-replay-logs

# JWT シークレット（リモートデプロイ用）
wrangler secret put JWT_SECRET
# → 対話式で安全な値を入力

# ローカル開発用シークレット
echo 'JWT_SECRET=local-dev-secret' > .dev.vars

# ローカル D1 マイグレーション適用
npx wrangler d1 migrations apply tomado-db --local
```

## 開発

```bash
# バックエンド起動（http://localhost:8787）
cd backend && npx wrangler dev

# フロントエンド起動（http://localhost:5173）
cd frontend && npm run dev
```

両方起動した状態でブラウザから `http://localhost:5173` にアクセス。
フロントエンドは自動的にローカルのバックエンドAPI（`localhost:8787`）に接続する。

## テスト

```bash
# 全パッケージ
npm test

# 個別
cd engine && npm test      # パズルエンジン（78テスト）
cd backend && npm test     # バックエンドAPI（15テスト）
```

## デプロイ

```bash
cd backend

# D1 マイグレーション適用（新規マイグレーション時のみ）
npx wrangler d1 migrations apply tomado-db --remote

# Workers デプロイ
npx wrangler deploy
```

## アーキテクチャ

### データフロー

```
[フロントエンド] ←→ [Cloudflare Workers API]
      |                    |
 localStorage          D1 (SQLite) ... ユーザー/TODO/スコア等
 (オフラインFB)        KV ............. ランキングキャッシュ
      |                R2 ............. リプレイログ
 [@tomado/engine]  ←→  [@tomado/engine]
 (ゲーム進行)          (リプレイ検証)
```

### 認証
- 初回起動時にデバイスIDで自動ゲスト登録
- JWT（アクセストークン1h / リフレッシュトークン90d）
- フロントエンドのAPIクライアントがトークン管理・自動リフレッシュを行う

### オフラインファースト
- localStorage をフォールバックとして維持
- API 呼び出し失敗時もローカルデータで動作継続
- オンライン復帰時にサーバーと同期

### パズルエンジン
- 全ての盤面生成・操作がシード値に基づく決定的処理
- 同一シード・同一操作で常に同一結果を保証
- バックエンド側でリプレイログを再計算してスコアを検証（不正対策）

## DB テーブル一覧

| テーブル | 用途 |
|---|---|
| `users` | ユーザー（スタミナ・Undoストック含む） |
| `todo_groups` | TODOグループ（最大5、付箋色対応） |
| `todos` | TODOタスク（サブタスクはJSON） |
| `stamina_recovery_logs` | スタミナ回復ログ（日次5回上限管理） |
| `daily_todo_progress` | 日次TODO進捗（アイテム権利・Undo管理） |
| `user_items` | アイテム所持数 |
| `puzzle_seeds` | パズルシード（シェアコード・デイリー管理） |
| `user_unlocked_seeds` | ユーザーのシードアンロック状態 |
| `play_scores` | プレイスコア記録 |
| `achievements` | 実績進捗 |
| `achievement_milestones` | 実績報酬受取管理 |

## API エンドポイント一覧

| メソッド | パス | 認証 | 説明 |
|---|---|---|---|
| POST | `/api/auth/register` | 不要 | ゲスト登録 + JWT発行 |
| POST | `/api/auth/refresh` | 不要 | トークンリフレッシュ |
| GET | `/api/user/profile` | 要 | プロフィール・スタミナ・アイテム取得 |
| PATCH | `/api/user/profile` | 要 | 表示名変更 |
| GET | `/api/todos` | 要 | TODO一覧 |
| POST | `/api/todos` | 要 | TODO作成 |
| PATCH | `/api/todos/:id` | 要 | TODO更新 |
| DELETE | `/api/todos/:id` | 要 | TODO削除 |
| POST | `/api/todos/:id/complete` | 要 | TODO完了（報酬連動） |
| GET | `/api/todo-groups` | 要 | グループ一覧 |
| POST | `/api/todo-groups` | 要 | グループ作成 |
| PATCH | `/api/todo-groups/:id` | 要 | グループ更新 |
| DELETE | `/api/todo-groups/:id` | 要 | グループ削除 |
| GET | `/api/daily-progress` | 要 | 日次進捗 |
| POST | `/api/daily-progress/claim-item` | 要 | アイテム入手 |
| POST | `/api/seeds/generate` | 要 | シード生成 |
| POST | `/api/seeds/:id/unlock` | 要 | シードアンロック |
| GET | `/api/seeds/daily` | 要 | 当日デイリーシード |
| GET | `/api/seeds/daily/calendar` | 要 | 過去デイリー一覧 |
| GET | `/api/seeds/:id` | 要 | シード詳細・ステータス |
| GET | `/api/seeds/by-code/:code` | 要 | シェアコードで検索 |
| POST | `/api/scores` | 要 | スコア送信 |
| GET | `/api/scores/my` | 要 | 自分のプレイ履歴 |
| GET | `/api/rankings/:seedId` | 要 | ランキング取得 |
| GET | `/s/:seedId` | 不要 | 共有URL（OGP/アプリ紹介） |

## 仕様書

詳細な仕様は `docs/SPEC.md` を参照。
