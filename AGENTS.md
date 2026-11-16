# AGENTS.md

このリポジトリで作業するときの規則。仕様はここに書かない。ゲームのルールと設計は `docs/DESIGN.md`、保存データ、API、D1 は
`docs/DATA_CONTRACT.md` に書く。

## プロジェクト
**Vege-Table** — デイリーパズル（3 マッチ）で、おじゃまタイルを全て消すまでの手数を競うカジュアルゲーム。Wordle モデル。
モードは Clear だけ（Sprint / Survival / Cascade は #102 で撤去した）。

- 仕様の正本は `docs/DESIGN.md`（ゲームのルール、画面、デイリー、ランキング、実績）と `docs/DATA_CONTRACT.md`（操作の表現、
  端末の保存、API、回数の制限、退会、旧 URL からの引き継ぎ、D1）。ゲームルール、API、データ構造に関わる変更の前に、該当する節を読む
- 本番 URL `https://vegtab.kan-game.app`（kan-game.app のゲームの 1 つ）。旧 URL `https://vegtab.app` は移転の案内と
  旧アカウントの引き継ぎだけを行う（`docs/DATA_CONTRACT.md`「旧 URL からの引き継ぎ」）
- ID、名前、退会は kan-game.app の ID 基盤（kan/game、`~/game`）と共通。kan/game 側の変更（`ALLOWED_ORIGINS`、
  `GAME_VEGTAB`、プライバシーポリシー、`docs/GAME_GUIDE.md` など）が要るときは、**vegtab の作業から kan/game を編集しない。**
  要る変更をまとめて、kan/game のセッションが動いていればそこへメッセージで、無ければ利用者に依頼する

## 構成
TAKO-SEN と NYORO-RIN と同じく、1 つのパッケージに置く（#125）。

```
src/
├── core/        # パズルのコア（純粋 TypeScript、フレームワーク非依存）。画面と Worker が相対の import で使う
├── ui/          # 画面（Vue、Pinia、vue-i18n）。`@/` は src/ui を指す。画面と URL の表は routes.ts
├── worker/      # Cloudflare Workers の API（素の fetch とルートの表）。入口は main.ts（default と GameService を export）
├── main.ts      # 画面の入口
└── App.vue
tests/{core,ui,worker}/   # テスト（vitest.config.ts の 3 つの project）
migrations/      # D1 のマイグレーション
public/、index.html       # 画面の静的ファイル（public/_headers は画面の応答のヘッダー）
scripts/         # dev.mjs（開発サーバー）、licenses-plugin.ts（ライセンス一覧）、generate-vapid-keys.ts
docs/DESIGN.md、docs/DATA_CONTRACT.md   # 仕様
wrangler.jsonc、vite.config.ts、vitest.config.ts、tsconfig.json（画面と core）、tsconfig.worker.json（Worker）
```

## 技術スタック
- **言語:** TypeScript（strict）
- **テスト:** Vitest（Worker は `@cloudflare/vitest-plugin`）
- **画面:** Vue.js（Composition API）、Pinia、vue-i18n。画面の切り替えは自前の router（`src/ui/lib/router.ts`）
- **Worker:** Cloudflare Workers（素の fetch とルートの表。フレームワークは使わない）、D1（SQLite）、KV、R2
- **認証:** kan-game.app の ID（ID 基盤が発行する Cookie の JWT を、Worker が公開鍵で検証する。`docs/DATA_CONTRACT.md`「API」）

## 環境セットアップ

```bash
npm install
```

**`package-lock.json` を削除してから作り直さないこと。** npm がその時点の
プラットフォーム向けの optional な native binding（`@rolldown/binding-*` /
`@rollup/rollup-*` / `@esbuild/*`）しか lockfile に残さないため、Linux で
作り直すと macOS や Windows での `npm ci` 後のビルドが `Cannot find native binding` で
失敗する。既存の lockfile を残したまま `npm install` / `npm audit fix` /
`npm i <pkg>@<ver>` で更新する。npm の版によって `libc` の指定が落ちることがあるので、更新したら差分を見る。

ライセンス一覧（`/licenses`、`scripts/licenses-plugin.ts`）は、画面のパッケージを build の bundle から、Service Worker と
Worker のパッケージを `SERVICE_WORKER_PACKAGES` と `SERVER_PACKAGES` から作る。Worker で新しいパッケージを import したら
`SERVER_PACKAGES` に足す（`tests/ui/licenses-plugin.test.ts` が import と突き合わせる）。workbox の設定を変えて
`SERVICE_WORKER_PACKAGES` とずれたら、build（`scripts/check-sw-licenses.ts`）が失敗する。
`package.json` の `dependencies` には Worker が bundle するパッケージを、画面のもの（vue など）は `devDependencies` に置く。

### 環境とリソース
環境はローカル（`wrangler.jsonc` の先頭）、開発（`env.dev`、`vegtab-dev.kan-game.app`）、本番（`env.production`、
`vegtab.kan-game.app` と旧 URL `vegtab.app`）の 3 つ。D1・KV・R2・VAPID の鍵・ID 基盤の公開鍵は環境ごとに別。
一覧は README「環境」。リモートのリソースの作成、secret の登録、デプロイは利用者の承認を得てから行う。

### ローカル開発用の設定
- ID 基盤（kan/game）を `../game`（または環境変数 `KAN_GAME_DIR`）に置き、kan/game 側で鍵の生成とローカル D1 の用意を
  済ませる（README「ローカルの ID 基盤」）。済んでいなければ `scripts/dev.mjs` は案内を出して止まる
- `.dev.vars` は要らない。`scripts/dev.mjs` が `ID_PUBLIC_KEYS`、`ALLOWED_ORIGINS`、`FRONTEND_URL`、`JWT_SECRET`、
  `DAILY_SEED_SECRET` を `--var` で渡す。`.dev.vars` を置くと、その値が `wrangler types` に入って `npm run typecheck` が失敗する
- ローカル D1 のマイグレーション適用（初回と、マイグレーションを足した後）: `npm run db:migrate`

### PWA アイコン
元の絵は `public/vegtab-icon.svg`（favicon も兼ねる）。`public/` の `apple-touch-icon.png`（180）、
`pwa-192x192.png`、`pwa-512x512.png`（maskable も兼ねる）は、この SVG から sharp で書き出したもの（背景は `#fff7ec` で塗る）。
絵を変えたら 3 つとも書き出し直す。

```bash
node -e "const s=require('sharp'),svg=require('fs').readFileSync('public/vegtab-icon.svg');for(const [o,n] of [['apple-touch-icon.png',180],['pwa-192x192.png',192],['pwa-512x512.png',512]])s(svg,{density:300}).resize(n,n).flatten({background:'#fff7ec'}).png().toFile('public/'+o)"
```

## ローカル開発の起動

ID 基盤（kan/game の `wrangler dev`）、Worker（`wrangler dev`）、画面（`vite`）は `scripts/dev.mjs` がまとめて起動する。

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
- ID 基盤と Worker のポートは起動のたびに空いているものを選ぶ。Vite は `/api` と `/s/` を Worker へ転送し
  （`vite.config.ts`、ポートは環境変数 `VEGTAB_API_PORT`）、Worker の `ID` binding は wrangler の dev registry で
  ID 基盤につながる。ポートを決め打ちしない
- roji 経由では画面とポータル（`localhost`）のホストが違い、ID の Cookie を共有しない。ポータル（復旧コード、退会）を
  通して確かめるときは `npm run dev:all` で起動する
- 終了は `Ctrl+C`。3 つとも止まり、roji のルートも取り消される

## デプロイ

SPA と API は 1 つの Worker で配信する。本番は `--env production` でデプロイするので、Worker 名は
`vegtab-api-production`（dashboard で探すときはこの名前。`vegtab-api` は本番では使っていない）。SPA は Workers の Static Assets
（`wrangler.jsonc` の `assets`、`dist`）で、`/api/*` `/s/*` だけが Worker のコードに回る。

```bash
# build（vue-tsc → vite build → ライセンス一覧の検査）→ 本番 D1 マイグレーション → Worker デプロイ（--env production）
npm run deploy                 # = npm run deploy:production

# DB マイグレーションだけを適用する場合
npm run db:migrate:prod

# 開発環境（vegtab-dev.kan-game.app）: build → 開発の D1 マイグレーション → Worker デプロイ（--env dev）
npm run deploy:dev
```

kan/game と vegtab は互いを Service Binding で指す。新しい環境では vegtab の Worker（`GameService` を持つ）を先に出し、
kan/game に `GAME_VEGTAB` を足すのはその後にする（先の Worker が無いと kan/game の退会が毎回失敗する）。

`deploy` は未適用のマイグレーションを先に適用してから Worker をデプロイする。
マイグレーションを追加するときは、先に適用してもデプロイ前の Worker が壊れない形
（テーブル・カラムの追加など）にすること。削除や名前の変更は、コードの対応をデプロイした後の
別マイグレーションで行う。

## テストと型検査

```bash
npm test                         # 全部（core、ui、worker の 3 つの project）
npx vitest run --project core    # パズルのコアだけ（ui、worker も同じ形）
npm run typecheck                # 画面と core（vue-tsc）、wrangler types --check、Worker（tsc -p tsconfig.worker.json）
npm run build                    # vue-tsc → vite build → scripts/check-sw-licenses.ts
```

CI（`.github/workflows/ci.yml`）は型検査、テスト、build を回す。

## 開発ルール

### 全般
- TypeScript の strict モードを有効にすること
- テスト駆動で進めること。機能実装前にテストを書くか、実装と同時にテストを書く
- コミットは機能単位で細かく行う

### src/core/
- UI やネットワークに一切依存しない純粋関数で構成する
- シード値を与えた場合に**完全に決定的な結果**を返すことを保証する
- 外部の乱数ライブラリは使わず、シード対応の擬似乱数生成器を自前実装する
- 画面（`src/ui/`）と Worker（`src/worker/`）の双方から利用される。どちらの型（DOM、Workers）にも依存しない
- Clear の盤面計算（初期配置・落下・補充・連鎖・スコア）を変えると、記録済みのリプレイの再生と検証がずれる

### src/worker/
- ルーティングは素の fetch とルートの表で行う（TAKO-SEN、NYORO-RIN と同じ。Hono、zod などのフレームワークを入れない）。
  ルートは `src/worker/routes/*.ts` が `Route` の配列で export し、`src/worker/main.ts` が公開のルートと ID の要るルートの
  2 つの表にまとめる。パスの照合は `src/core/path.ts`（画面の router と同じ規則）
- 認証: ID の要るルートは、`src/worker/main.ts` がルートを引く前に `src/worker/lib/id-auth.ts` の `requireAccount` で
  Cookie を検証し、ハンドラーに `accountId` を渡す。`/api/id/*` は ID 基盤へそのまま中継する
  - **`src/worker/lib/id-token.ts`、`src/worker/lib/id-rpc.ts`、`tests/worker/kan-game/` のファイルは書き換えない。** kan/game の `src/token.ts`、`src/rpc.ts`、`testing/`、`test-vectors/id-token.json` の写しで、kan/game が更新したら写し直す（今の写しは kan/game の `258c299`）
  - 状態を変える API は `Origin` が `ALLOWED_ORIGINS` に含まれることを必須にする（`requireAccount` が確かめる）
  - 名前は ID 基盤の `registerName`（RPC）で登録し、`profiles` に写す。名前の規則を vegtab で持たない
  - 記録を持つテーブルを足したら、退会（`src/worker/lib/account.ts` の `ACCOUNT_TABLES`）にも足す
- 応答に、ほかの人の ID を入れない（自分の行かは `isSelf` などでサーバーが判定する）
- エラーの本文は `{ error: "<コード>" }`（英小文字と `_`）。応答は `src/worker/lib/http.ts` の `json` などで作る
- 本文は `src/worker/lib/http.ts` の `readJsonBody(request, parse, limit?)` で読み、ルートごとの `parseXxx`（値を知っている
  フィールドだけで組み直して返すか、`undefined`）で検証する。部品は `src/worker/lib/validate.ts`。整数は安全な整数だけを受け付ける
- 重い処理（リプレイの検証、ID 基盤の RPC）の前に、ID ごとの回数の制限（`src/worker/lib/rate-limit.ts`）を取る
- 旧 URL（`vegtab.app`）の旧アカウントのための JWT（`src/worker/lib/jwt.ts`、`refresh-tokens.ts`、`routes/auth.ts`、`routes/legacy.ts`）は、移転の案内と引き継ぎにだけ使う。新しい機能で使わない
- テスト: `@cloudflare/vitest-plugin` で Workers 環境をエミュレート。D1 のスキーマは `migrations/` を `tests/worker/apply-migrations.ts` で当てる（テスト用のスキーマを別に書かない）
  - API は `tests/worker/helpers.ts` の `call` で呼ぶ（`SELF.fetch` は使わない）。ID 基盤の偽物（`idPlatform`）とテスト用の鍵で動かすため。`registerUser({ name })` で名前と同意のある ID を作る
- Workers の型は `wrangler types` で生成した `worker-configuration.d.ts` を使う（`@cloudflare/workers-types` は使わない）。`wrangler.jsonc` を変えたら `npm run cf-typegen` で作り直す。`npm run typecheck` は生成した型が古ければ失敗する。型は `.dev.vars` が無い状態で生成する（あると、その値が型に入って食い違う）
- シークレット（`JWT_SECRET` など）は生成した型に入らないので、`src/worker/types.ts` の `Bindings` に足す
- デイリーシードは Worker が `DAILY_SEED_SECRET` の HMAC から作り、当日になってから API で配る（#116、`docs/DATA_CONTRACT.md`「デイリーシード」）。**今日より先の日のシードを返す API を作らない**（先の日の盤を前日までに解けてしまうため）

### src/ui/
- 画面と URL の表は `src/ui/routes.ts`。画面は `@/routes` の `useRoute()` / `useRouter()`（`push`、`replace`、`back`）で
  切り替える（vue-router は使わない）。`<a href>` で画面の中を移るときは、クリックを `router.push` に渡す
- kan-game.app の ID の状態（発行、延長、`401` / `410` からの回復、引き継ぎコード、ポータルの URL）は `src/ui/api/id.ts` に集める。ID が変わると、ストアは `onIdChange` で中身を入れ替える
- API クライアント（`src/ui/api/client.ts`）が API の呼び出しとオフラインのリトライを一元管理する。API は同一オリジンの相対パスで呼ぶ（Cookie を付けるため）
- 旧 URL（`vegtab.app`）では、ゲームの代わりに移転の案内（`src/ui/legacy/`）を出す
- optimistic local-first: localStorage をフォールバックとして維持しつつ API を呼ぶ
- API 失敗時もローカルデータで動作継続。ただし、その日のデイリーシードは一度 API から受け取るまで遊べない（端末で計算しないため。受け取った日は `vegtab_daily_seeds` に覚え、オフラインでも遊べる）
- **画面と core でデイリーシードを計算しない**（日付から本番の盤のシードを求める処理を置かない。試作画面の練習用のシードは別）
- ランキングとベストの比較は画面と Worker で同じものを持つ（`src/ui/lib/bestResult.ts` と `src/worker/lib/ranking-rule.ts`）。規則を変えるときは両方を直し、ランキングのキャッシュキーの版も上げる
- 遊び方の練習の段の盤を変えたら `tests/ui/tutorial/lessons.test.ts` を通す
- localStorage のキーは `vegtab_` で始める

### テスト
- フレームワーク: Vitest
- 各機能に正常系・境界値・エッジケースのテストを記述
- 特に「同一シード・同一操作で常に同一結果」の決定性テストを必須とする
- `npm test`（ルート）で全てのテストが実行できるようにする
