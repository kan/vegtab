# Vege-Table

デイリーパズル（3 マッチ）で、おじゃまタイルを全て消すまでの手数を競うカジュアルゲーム。Wordle モデル。
kan-game.app のゲームの 1 つで、本番は `https://vegtab.kan-game.app`。ID、名前、退会は kan-game.app の ID 基盤（kan/game）と共通。

## 構成

| パッケージ | 技術 | 説明 |
|---|---|---|
| `engine/` | TypeScript | パズルエンジン。純粋関数、フレームワーク非依存。シード値による決定的な盤面生成・マッチ判定・連鎖処理・アイテム・スコア計算 |
| `frontend/` | Vue.js, Pinia | SPA。パズル画面、HOME、実績、リプレイ、チュートリアル |
| `backend/` | Cloudflare Workers, Hono | API。シード、スコア、ランキング、実績、プッシュ通知、ID 基盤への中継 |

モノレポ構成（npm workspaces）。`engine/` は `frontend/` と `backend/` 双方から利用される。

## セットアップ

### 前提
- Node.js 18+
- Cloudflare アカウント
- kan/game（ID 基盤）をこのリポジトリの隣（`../game`）に置く。ローカルでも ID は本番と同じ経路（ID 基盤の Cookie）で発行と検証をする

### インストール

```bash
git clone <repo-url> && cd vegtab
npm install
```

### ローカルの ID 基盤（初回のみ）

kan/game 側で次を済ませる（手順の正本は kan/game の README）。

```bash
cd ../game
npm install
npm run generate-key -- --dev-vars             # .dev.vars にローカル用の鍵を書く
npx wrangler d1 migrations apply DB --local
echo 'ALLOWED_ORIGINS=http://localhost:5173' >> .dev.vars   # vegtab の画面から ID の API を呼ぶため
```

### backend のローカル設定（初回のみ）

`backend/.dev.vars`（`.gitignore` 済み）に次を書く。

```
JWT_SECRET=<任意の値>
ID_PUBLIC_KEYS=<kan/game の .dev.vars の ID_PUBLIC_KEYS をそのまま写す>
```

```bash
npm run db:migrate -w backend   # ローカル D1 のマイグレーション
```

## 開発

```bash
# ターミナル1: ID 基盤（http://localhost:8787）
cd ../game && npm run dev

# ターミナル2: backend（http://localhost:8788）と frontend（http://localhost:5173）
npm run dev
```

ブラウザで `http://localhost:5173` を開く。frontend の `/api` と `/s/` は Vite が backend へ転送する（同一オリジン）。
backend の `ID` binding は、wrangler の dev registry で別プロセスの ID 基盤（`kan-game-local`）につながる。
復旧コードと退会はポータル（`http://localhost:8787/account`）で確かめる。`localhost` の Cookie はポートをまたいで共有される。

## テスト

```bash
npm test                       # 全パッケージ
cd engine && npm test          # パズルエンジン
cd backend && npm test         # backend（ID 基盤は test/kan-game/ の偽物を使う）
cd frontend && npm test
```

## 環境

| 環境 | URL | Worker | D1 | ID 基盤 |
|---|---|---|---|---|
| ローカル | `http://localhost:5173` | `wrangler dev` | ローカルの D1 | kan/game の `wrangler dev` |
| 開発 | `https://vegtab-dev.kan-game.app` | `vegtab-dev` | `vegtab-dev` | `dev.kan-game.app`（Worker `kan-game-dev`） |
| 本番 | `https://vegtab.kan-game.app` | `vegtab-api-production` | `tomado-db` | `kan-game.app`（Worker `kan-game`） |

本番の Worker は、旧 URL の `vegtab.app` も配信する。旧 URL は移転の案内と、旧アカウントの記録の引き継ぎだけを行う（`docs/SPEC.md` §5.4）。

## デプロイ

SPA と API は 1 つの Worker で配信する。SPA は Workers の Static Assets（`frontend/dist`）で、`/api/*` `/s/*` だけが Worker のコードに回る（`backend/wrangler.jsonc` の `assets`）。

```bash
# 本番: frontend build → 本番 D1 マイグレーション → Worker デプロイ（--env production）
npm run deploy

# 開発: frontend build の後に
npm run build && npm run deploy:dev -w backend
```

未適用の D1 マイグレーションは Worker のデプロイより先に適用される。
そのため、マイグレーションは「先に適用しても、デプロイ前の Worker が壊れないもの」（テーブル・カラムの追加など）にすること。
カラムの削除や名前の変更が必要な場合は、コードの対応をデプロイしてから別のマイグレーションで行う。

kan/game と vegtab は互いを Service Binding で指す（vegtab → `ID`、kan/game → `GAME_VEGTAB`）。新しい環境では vegtab の Worker を先に出し、kan/game に `GAME_VEGTAB` を足すのはその後にする。先の Worker が無いと、kan/game の退会が毎回失敗する。

### 環境変数

| 変数 | 場所 | 説明 |
|------|------|------|
| `FRONTEND_URL` | vars | ゲームの URL（共有 URL、旧 URL からの引き継ぎ先） |
| `ALLOWED_ORIGINS` | vars | API を呼べるオリジン（カンマ区切り）。状態を変えるリクエストは `Origin` が一致しないと `403` |
| `LEGACY_HOST` | vars | 移転の案内だけを出す旧ホスト（本番は `vegtab.app`）。空なら無し |
| `ID_COOKIE_NAME` / `ID_ISSUER` / `ID_PUBLIC_KEYS` | vars | ID の Cookie の名前、`iss`、検証用の公開鍵。kan/game の同じ環境の値に合わせる。鍵の入れ替えは kan/game の `docs/ID_DESIGN.md`「鍵の管理」 |
| `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | vars | Web Push。環境ごとに鍵ペアを作る（`backend/scripts/generate-vapid-keys.ts`） |
| `VAPID_PRIVATE_KEY` | secret | Web Push の秘密鍵 |
| `JWT_SECRET` | secret | 旧 URL の旧アカウントのトークンの署名鍵。旧 URL を閉じたら外す |
| `ENVIRONMENT` | vars | `development` / `dev` / `production` |

## ドメイン

`vegtab.kan-game.app` と `vegtab-dev.kan-game.app` は Worker の Custom Domain（`"custom_domain": true`）で、DNS レコードは Cloudflare が作って管理する。
`vegtab.app` は route（`vegtab.app/*`）で本番の Worker に向けている。route は DNS レコードを作らないので、`vegtab.app` のゾーンに dashboard で足した proxied の `AAAA 100::` が要る。旧 URL を配信するあいだは消さない。閉じる手順は `docs/SPEC.md` §5.4。

## アーキテクチャ

```
[frontend] ←→ [Worker（vegtab）] ←→ [Worker（kan/game、ID 基盤）]
     |              |   /api/id/* を中継、名前の登録（RPC）
localStorage        |   ← 退会（GameService.deleteAccount）
(オフライン)    D1 ... スコア、実績、名前の写し、プッシュ通知の購読
     |          KV ... ランキングのキャッシュ
     |          R2 ... リプレイ
[@vegtab/engine]  ←→  [@vegtab/engine]
(ゲーム進行)          (リプレイ検証)
```

- 認証: kan-game.app の ID の Cookie（`HttpOnly`、`Domain=kan-game.app`）。Worker が公開鍵で検証する（`docs/SPEC.md` §5.1）
- オフラインファースト: localStorage をフォールバックとして維持し、API が失敗してもローカルデータで動作を続ける
- 不正対策: backend がリプレイログを engine で再計算してスコアを検証する

テーブルは `docs/SPEC.md` §6、API は `backend/src/routes/` を参照。

## 仕様書

詳細な仕様は `docs/SPEC.md` を参照。
