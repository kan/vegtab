# Vege-Table

デイリーパズル（3 マッチ）で、おじゃまタイルを全て消すまでの手数を競うカジュアルゲーム。Wordle モデル。
kan-game.app のゲームの 1 つで、本番は `https://vegtab.kan-game.app`。ID、名前、退会は kan-game.app の ID 基盤（kan/game）と共通。

## 構成

1 つのパッケージに、TAKO-SEN と NYORO-RIN と同じ形で置く（#125）。

| 場所 | 技術 | 説明 |
|---|---|---|
| `src/core/` | TypeScript | パズルのコア。純粋関数、フレームワーク非依存。シード値による決定的な盤面生成・マッチ判定・連鎖処理・アイテム・スコア計算 |
| `src/ui/`、`src/main.ts`、`src/App.vue` | Vue.js, Pinia | SPA。パズル画面、HOME、実績、リプレイ、チュートリアル |
| `src/worker/` | Cloudflare Workers | API。シード、スコア、ランキング、実績、プッシュ通知、ID 基盤への中継。入口は `src/worker/main.ts` |
| `tests/core/`、`tests/ui/`、`tests/worker/` | Vitest | それぞれのテスト。Worker のテストは `@cloudflare/vitest-plugin` |
| `migrations/` | D1 | マイグレーション |
| `public/`、`index.html` | | 画面の静的ファイル |
| `scripts/` | | 開発サーバーの起動（`dev.mjs`）、ライセンス一覧の生成（`licenses-plugin.ts`）、VAPID の鍵の生成 |

`src/core/` は画面と Worker の双方から相対の import で使う。設定（`wrangler.jsonc`、`vite.config.ts`、`vitest.config.ts`）はルートに 1 つずつ。
型検査は 2 つに分ける: 画面と core は `tsconfig.json`（DOM）、Worker は `tsconfig.worker.json`（Workers の型）。

## セットアップ

### 前提
- Node.js 22+
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
```

kan/game を別の場所に置くときは、環境変数 `KAN_GAME_DIR` で指定する。

### ローカル D1（初回と、マイグレーションを足した後）

```bash
npm run db:migrate
```

## 開発

ID 基盤（kan/game の `wrangler dev`）、Worker（`wrangler dev`）、画面（`vite`）は `scripts/dev.mjs` がまとめて起動する（TAKO-SEN と同じ形）。

| コマンド | 用途 |
|---|---|
| `npm run dev:roji` | [roji](https://github.com/kan/roji) を通して起動する。`https://vegtab.<roji のドメイン>` で開ける |
| `npm run dev:all`（`npm run dev`） | roji なしで起動する。画面は `http://localhost:5173` |

- roji が使える環境（`command -v roji` が成功し、`roji health` が「正常」）では `npm run dev:roji` を使う。開く URL は起動時に出る `roji: https://... -> localhost:<ポート>` の行か `roji routes` で確かめる
- ID 基盤と Worker のポートは、起動のたびに空いているものを選ぶ。画面の `/api` と `/s/` は Vite が Worker へ転送する（同一オリジン）。Worker の `ID` binding は、wrangler の dev registry で ID 基盤（`kan-game-local`）につながる
- `scripts/dev.mjs` は、画面の URL を `ALLOWED_ORIGINS` として Worker と ID 基盤へ渡し、kan/game の `.dev.vars` の `ID_PUBLIC_KEYS` を Worker へ渡す。kan/game とこのリポジトリの `.dev.vars` に書き足す必要はない
- roji 経由では、画面（roji の URL）とポータル（`localhost`）のホストが違い、ID の Cookie を共有しない。復旧コードや退会をポータルで試すときは `npm run dev:all` で起動し、起動時に出る ID 基盤の URL を開く
- ローカルでは Web Push の送信は止まっている（秘密鍵が無い）。購読の登録はできるが、公開鍵は `wrangler.jsonc` の既定のもの。送信を試すときは、環境変数 `VAPID_PUBLIC_KEY` と `VAPID_PRIVATE_KEY` の組（`scripts/generate-vapid-keys.ts`）を両方付けて起動する
- 終了は `Ctrl+C`。3 つとも止まり、roji のルートも取り消される。どれかが落ちたときも、ほかを止めて終了する

## テスト

```bash
npm test                       # 全部（core、ui、worker の 3 つの project）
npx vitest run --project core  # パズルのコアだけ
npx vitest run --project worker  # Worker だけ（ID 基盤は tests/worker/kan-game/ の偽物を使う）
npx vitest run --project ui    # 画面だけ
npm run typecheck              # 型検査（画面と core、wrangler types --check、Worker）
```

## 環境

| 環境 | URL | Worker | D1 | ID 基盤 |
|---|---|---|---|---|
| ローカル | `http://localhost:5173` | `wrangler dev` | ローカルの D1 | kan/game の `wrangler dev` |
| 開発 | `https://vegtab-dev.kan-game.app` | `vegtab-dev` | `vegtab-dev` | `dev.kan-game.app`（Worker `kan-game-dev`） |
| 本番 | `https://vegtab.kan-game.app` | `vegtab-api-production` | `tomado-db` | `kan-game.app`（Worker `kan-game`） |

本番の Worker は、旧 URL の `vegtab.app` も配信する。旧 URL は移転の案内と、旧アカウントの記録の引き継ぎだけを行う（`docs/DATA_CONTRACT.md`「旧 URL からの引き継ぎ」）。

## デプロイ

SPA と API は 1 つの Worker で配信する。SPA は Workers の Static Assets（`dist`）で、`/api/*` `/s/*` だけが Worker のコードに回る（`wrangler.jsonc` の `assets`）。

```bash
# 本番: build → 本番 D1 マイグレーション → Worker デプロイ（--env production）
npm run deploy                 # = npm run deploy:production

# 開発（vegtab-dev.kan-game.app）: build → 開発の D1 マイグレーション → Worker デプロイ（--env dev）
npm run deploy:dev
```

本番の `npm run deploy` は、出し終えたら `production` タグを今のコミット（HEAD）へ動かし、出した日時のタグ
`production-<UTC の日時>` も足して push する（`tag:production`）。kan/dotfiles の `gh-blog-diff` が、本番に出た変更を
これらのタグから拾うため。コミットしてから出す。
タグの push だけが失敗したときは、出したコミットで `npm run tag:production` を実行し直す。

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
| `VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | vars | Web Push。環境ごとに鍵ペアを作る（`scripts/generate-vapid-keys.ts`） |
| `VAPID_PRIVATE_KEY` | secret | Web Push の秘密鍵 |
| `JWT_SECRET` | secret | 旧 URL の旧アカウントのトークンの署名鍵。旧 URL を閉じたら外す |
| `DAILY_SEED_SECRET` | secret | 日ごとの seed を作る HMAC の鍵（`src/worker/lib/seed.ts`）。環境ごとに別の値にする。漏れると、まだ配っていない日の盤面を計算できる。変えても、既に行のある日の seed は変わらない |
| `ENVIRONMENT` | vars | `development` / `dev` / `production` |

## ドメイン

`vegtab.kan-game.app` と `vegtab-dev.kan-game.app` は Worker の Custom Domain（`"custom_domain": true`）で、DNS レコードは Cloudflare が作って管理する。
`vegtab.app` は route（`vegtab.app/*`）で本番の Worker に向けている。route は DNS レコードを作らないので、`vegtab.app` のゾーンに dashboard で足した proxied の `AAAA 100::` が要る。旧 URL を配信するあいだは消さない。

旧 URL を閉じるのは 2027 年に入ってから（TAKO-SEN の旧 URL と同じ扱い、2026-10-22 に決定）。それまでは引き継ぎを受け付ける。閉じるときは次の順に行う。

1. route（`vegtab.app/*`）を `wrangler.jsonc` と dashboard の両方から消す（設定から消しても dashboard の route は外れない）
2. `vegtab.app` のゾーンの `AAAA 100::` を消す
3. 旧 URL のための仕組みを外す（#109）。外すのは次のもの
   - 旧アカウントの表: `users`、`user_devices`、`transfer_codes`、`refresh_token_families`、`legacy_handoffs`
   - secret の `JWT_SECRET` と、API の `/api/auth/refresh`、`/api/legacy/handoff`
   - 画面の `src/ui/legacy/`

## アーキテクチャ

```
[画面]     ←→ [Worker（vegtab）] ←→ [Worker（kan/game、ID 基盤）]
     |              |   /api/id/* を中継、名前の登録（RPC）
localStorage        |   ← 退会（GameService.deleteAccount）
(オフライン)    D1 ... スコア、実績、名前の写し、プッシュ通知の購読
     |          KV ... ランキングのキャッシュ
     |          R2 ... リプレイ
[src/core]       ←→  [src/core]
(ゲーム進行)          (リプレイ検証)
```

- 認証: kan-game.app の ID の Cookie（`HttpOnly`、`Domain=kan-game.app`）。Worker が公開鍵で検証する（`docs/DATA_CONTRACT.md`「API」）
- オフラインファースト: localStorage をフォールバックとして維持し、API が失敗してもローカルデータで動作を続ける
- 不正対策: Worker がリプレイログを src/core で再計算してスコアを検証する

## 仕様書

- `docs/DESIGN.md`: ゲームのルールと設計（盤面、アイテム、おじゃまタイル、スコア、デイリー、ランキング、実績、画面）
- `docs/DATA_CONTRACT.md`: 操作の表現、端末の保存、API、回数の制限、退会、旧 URL からの引き継ぎ、D1
