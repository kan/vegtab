# Vege-Table

デイリーパズル（3マッチ）でスコアを競うカジュアルゲーム。Wordleモデル。

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
git clone <repo-url> && cd vegtab
npm install
```

### Cloudflare リソース作成（初回のみ）

```bash
cd backend

# D1 データベース
wrangler d1 create tomado-db
# → 出力の database_id を wrangler.jsonc に反映

# KV namespace
wrangler kv namespace create KV
# → 出力の id を wrangler.jsonc に反映

# R2 バケット（リプレイログ保存用）
wrangler r2 bucket create tomado-replay-logs

# JWT シークレット（リモートデプロイ用）
wrangler secret put JWT_SECRET
# → 対話式で安全な値を入力

# ローカル開発用シークレット
echo 'JWT_SECRET=local-dev-secret' > .dev.vars

# ローカル D1 マイグレーション適用
npm run db:migrate
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

### 前提条件

- `wrangler` が認証済み（`npx wrangler login`）
- D1 / KV / R2 が作成済み（`backend/wrangler.jsonc` にID記載）
- 本番 JWT シークレット設定済み

### 初回セットアップ

```bash
# 1. 本番 D1 マイグレーション実行
npm run db:migrate:prod -w backend

# 2. JWT シークレットを設定（対話式）
npx -w backend wrangler secret put JWT_SECRET --env production
```

### リリース手順

SPA と API は 1 つの Worker（`vegtab-api`）で配信する。SPA は Workers の Static Assets（`frontend/dist`）で、
`/api/*` `/s/*` だけが Worker のコードに回る（`backend/wrangler.jsonc` の `assets`）。

```bash
# frontend build → 本番 D1 マイグレーション → Worker デプロイ（--env production）
npm run deploy
```

フロントとバックが 1 回のデプロイで同時に切り替わる。
未適用の D1 マイグレーションは Worker のデプロイより先に適用される（適用前に確認を求められる）。
そのため、マイグレーションは「先に適用しても、デプロイ前の Worker が壊れないもの」（テーブル・カラムの追加など）にすること。
カラムの削除や名前の変更が必要な場合は、コードの対応をデプロイしてから別のマイグレーションで行う。

### 環境変数

| 変数 | 場所 | 説明 |
|------|------|------|
| `FRONTEND_URL` | Workers vars | CORS許可オリジン。カンマ区切りで複数指定可。`*` で全許可 |
| `ENVIRONMENT` | Workers vars | `development` / `production` |
| `JWT_SECRET` | Workers secret | JWT署名キー（`wrangler secret put` で設定） |
| `VITE_API_BASE` | `frontend/.env.production` | バックエンドAPIのベースURL |

## カスタムドメイン設定

`vegtab.app` のようなカスタムドメインを設定する手順。

### 1. ドメイン取得 & Cloudflare DNS

1. レジストラで `vegtab.app` を取得
2. Cloudflare ダッシュボード → **Add a site** → `vegtab.app` を追加
3. レジストラのネームサーバーを Cloudflare 指定のものに変更
4. DNS 反映を待つ（通常 数分〜数時間）

### 2. Worker のルーティング

`backend/wrangler.jsonc` の `env.production` の `routes` で、`vegtab.app/*` を Worker に向ける。
SPA と API は同じ Worker が同一オリジンで配信する。
Pages からの移行期間は、ロールバック用に旧 route（`/api/*` `/s/*`）も残している（`wrangler.jsonc` のコメントを参照）。

```jsonc
"routes": [
  { "pattern": "vegtab.app/*", "zone_name": "vegtab.app" },
],
```

API のベース URL は `frontend/.env.production` に設定する。

```
VITE_API_BASE=https://vegtab.app
```

### 3. 設定ファイル更新チェックリスト

| ファイル | 更新内容 |
|----------|----------|
| `backend/wrangler.jsonc` | `env.production` に `routes` 追加、`FRONTEND_URL` をカスタムドメインに |
| `frontend/.env.production` | `VITE_API_BASE` を本番URLに変更 |

```bash
# 変更後に再デプロイ
npm run deploy
```

### 4. 動作確認

```bash
# ヘルスチェック
curl https://vegtab.app/api/health

# OGP (クローラーとして)
curl -A "Twitterbot" https://vegtab.app/s/TEST123

# ブラウザでアクセス
open https://vegtab.app
```

## アーキテクチャ

### データフロー

```
[フロントエンド] ←→ [Cloudflare Workers API]
      |                    |
 localStorage          D1 (SQLite) ... ユーザー/TODO/スコア等
 (オフラインFB)        KV ............. ランキングキャッシュ
      |                R2 ............. リプレイログ
 [@vegtab/engine]  ←→  [@vegtab/engine]
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
