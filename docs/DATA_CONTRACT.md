# Vege-Table のデータ契約

本書は、操作の表現、端末の保存データ、API、D1 が満たすべき契約を定める。ゲームのルールの正本は [`DESIGN.md`](./DESIGN.md) とする。

仕組みは kan-game.app のほかのゲーム（TAKO-SEN、NYORO-RIN）に倣う。ID、名前、退会の正本は kan/game の `docs/ID_DESIGN.md` で、ここには vegtab から見た契約だけを書く。

## 操作の表現（リプレイログ）

1 ゲームの操作は `ReplayAction` の配列で表す（`src/core/types.ts`）。コアはシード値とこの配列から、全ての途中の盤面を作り直せる（DESIGN.md 9 章）。

| `type` | 形 | 操作 |
|---|---|---|
| `swap` | `{ type, pos, dir }` | スワイプ |
| `tap` | `{ type, pos }` | アイテムのタップ |
| `scope` | `{ type, pos, targetCells }` | スプーンのタップ（選んだマス） |
| `scope_swap` | `{ type, pos, dir, targetCells }` | スワイプで動かしたスプーンの発動 |
| `scope_synthesis` | `{ type, pos1, pos2, targetCells }` | スプーンの合成 |

- `pos` / `pos1` / `pos2` / `targetCells` の要素は `{ row, col }`（0〜7 の整数）。`dir` は `up` / `down` / `left` / `right`。`targetCells` は 3 件まで
- サーバーはこの形だけを受け付け、知らないフィールドは落として保存する（「`POST /api/scores`」）
- ベスト記録のリプレイは R2 に置く。キーは `replays-v2/<ID>/<seed_id>/<UUID>.json`（`src/worker/lib/replay-key.ts`）。#106 より前の盤面のリプレイ（`replays/` の下）は、kan-game.app への移行で捨てた（「旧 URL からの引き継ぎ」）

## デイリーシード

- その日のシードは、Worker が secret（`DAILY_SEED_SECRET`）を鍵にした日付の HMAC-SHA256 から作る（`src/worker/lib/seed.ts`、#116）。secret を知らないと、まだ配っていない日のシードは計算できない
- その日の行が `puzzle_seeds` にあれば、その値を使う。行はその日の `GET /api/seeds/daily`、カレンダー、スコアの送信のうち最初のもので作る。2026-11-16 より前の日は、HMAC を使う前の値（日付の文字列のハッシュ）のまま（既に配った値で、端末の記録とも合わせるため）
- **画面と core はデイリーシードを計算しない。** 日付から本番の盤のシードを求める処理を置かない（チュートリアルと試作の画面の練習用のシードは別）。**今日より先の日のシードを返す API を作らない。** スコアの送信も、今日より先の日を受け付けない
- 画面は `GET /api/seeds/daily`（今日）と `GET /api/seeds/daily/calendar?month=YYYY-MM`（その月の今日までの日）から受け取り、`vegtab_daily_seeds` に覚える。その日に一度も受け取れていなければ、今日のパズルは始められない
- カレンダーは、最初のデイリーの日（`puzzle_seeds` の最も古い `daily_date`）より前を返さない。応答の `firstDate` を画面も覚え（`vegtab_first_daily_date`）、その月より前へはめくらない。返す日に行が無ければ、その場で行を作る（配ったシードには必ず行がある）。作るのは最初のデイリーの日から今日までの日だけで、どの日も一度だけ
- 端末が受け取っていないシードでパズルを開いたとき（共有のリンク）は、`GET /api/seeds/by-value/:value` でその日を引く。行のある日（今日までに配った日）だけを答えるので、先の日のシードは明かさない

## 端末の保存

localStorage のキーは `vegtab_` で始める（旧キーを除く）。値が読めないとき（壊れた JSON、形の違う値）は、既定の値として扱う。

| キー | 内容 |
|---|---|
| `vegtab_kan_game_id` | ID 基盤が最後に確かめた ID。資格情報ではない（資格情報は Cookie）。送れなかったスコアをどの ID が積んだかの判定に使う |
| `vegtab_display_name` | ランキングに公開している名前の写し |
| `vegtab_daily_seeds` | 日付 → デイリーシード。直近 62 日分で、それより古い日は読み込みで捨て、カレンダーで開いたときにまた受け取る |
| `vegtab_first_daily_date` | カレンダーがめくれる最初の日 |
| `vegtab_play_records` | プレイの記録（下の「プレイの記録」） |
| `vegtab_play_time` | seed ごとのその日の累計のプレイ時間（`s<seed>` → ミリ秒）。90 seed まで |
| `vegtab_share_codes_v2` | seed → 共有コードのキャッシュ |
| `vegtab_offline_queue` | 送れなかったスコア（下の「送れなかったスコアのキュー」）。読めないときは `vegtab_offline_queue.corrupt` に退避する |
| `vegtab_achievements` | 実績の状態のキャッシュ（サーバーが正） |
| `vegtab_tutorial_v2` | チュートリアルを既読にしたか。紙芝居の版の既読（`vegtab_tutorial`）は引き継がない |
| `vegtab_locale` | 表示の言語 |
| `vegtab_anim_speed` | アニメーションの速度 |
| `vegtab_sound_se` / `vegtab_sound_bgm` / `vegtab_sound_vibration` | 効果音、BGM、振動の設定 |
| `vegtab_access_token` / `vegtab_refresh_token` | 旧 URL（`vegtab.app`）の旧アカウントのトークン。旧 URL の画面が引き継ぎにだけ使う |

sessionStorage は 2 つ。`vegtab_puzzle_state` はプレイ中の盤面とリプレイログで、画面を離れて戻ったときに復元する。`vegtab_stale_chunk_reload` は、古いチャンクのための読み込み直しをした時刻（DESIGN.md 8 章。1 つのタブで 60 秒に 1 回まで）。

- ブラウザに残る撤去したモードのデータ（プレイの記録、途中の盤面、実績のキャッシュ、キューのスコアの送信）は読み込まない（`src/ui/lib/legacyData.ts`）
- 旧 URL のオリジンの localStorage は、新しい URL からは読めない（オリジンが違う）

### プレイの記録

`vegtab_play_records` の各記録は、そのデイリーの日付（`date`）を持ち、スコアの送信に使う。

- 日付を持つ前の記録と、日付が分からないまま遊んだ記録（オフラインで共有のリンクから開いた）は、起動時の再送で日付を引いてから送る
- サーバーが 400 で断った記録（受け付ける期間を過ぎた日など）と、デイリーでないシードの記録は、リプレイログを捨てて送り直さない
- サーバーが受け付けた記録は再送しないので、容量を食うリプレイログを捨てる

## 送れなかったスコアのキュー

スコアの送信（`POST /api/scores`）は、通信の失敗、5xx、429 のとき端末のキュー（`vegtab_offline_queue`）に積み、後で送り直す（`src/ui/api/offlineQueue.ts`）。

- **項目:** `{ id, url, method, body, createdAt, retries, userId, dedupeKey?, summary? }`
- **送り直すとき:** `online` イベント、アプリの起動、429 の `Retry-After` の時間が過ぎたとき
- **送る ID:** 項目を積んだ ID（`userId`）と今の ID が違えば、送らずに捨てる。処理の途中で ID が切り替わっても、旧い ID の項目は送らない。ID がまだ無いあいだは送らずに待つ
- **リトライ:** 通信の失敗、5xx、401 / 410 は `retries` を増やし、3 回で捨てる（捨てたら利用者に知らせる）。409 は送れたものとして扱う。そのほかの 4xx は送り直さない
- **429:** 項目は傷んでいないので `retries` を増やさずに残す。残りの項目も同じ ID の枠を使うので、その回の送信をやめ、`Retry-After`（無ければ 60 秒）の後に送り直す
- **有効期限:** 24 時間。期限が切れた項目は読み込みで捨てる
- **件数の上限:** 20 件（#123）。超えたら古いものから捨てる。項目は操作列を持つので、端末の保存の容量を食い尽くさないため
- **まとめ:** ID と日（`dedupeKey`）が同じ項目は、良い方の記録（`summary`。DESIGN.md 3.7 節と同じ比較）だけを残す。新しい方が良くなければ積まない。`summary` の無い項目（前の版で積んだもの）は新しい記録で置き換える。捨てた方のプレイだけで満たした実績（連鎖など）は、その送信では判定されない
- **旧キー:** #123 より前の `offline_queue` に残る項目は、読むときに取り込んで旧キーを消す
- **保存の失敗:** 積もうとして端末に保存できなかった（容量超過など）ときは、送れないかもしれないことをエラーのトーストで知らせる

## API

全て `/api/` の下で、画面と同じオリジン（`vegtab.kan-game.app`）から呼ぶ。Worker のルートは `src/worker/main.ts` の表と `src/worker/routes/` にある。

- **認証:** ID 基盤が発行する、`Domain=kan-game.app` の `HttpOnly` Cookie（ES256 で署名した JWT、400 日）。画面はトークンを持たず、同じオリジンの `/api/*` に Cookie が付く
  - Worker は ID 基盤の公開鍵（`ID_PUBLIC_KEYS`）で Cookie を検証し、`sub` を ID として使う。API ごとに ID 基盤へ問い合わせない。検証のコード（`src/worker/lib/id-token.ts`）と RPC の型（`id-rpc.ts`）は kan/game の `src/token.ts` と `src/rpc.ts` の写しで、書き換えない。テストベクター（`tests/worker/kan-game/`）と一緒に写し直す
  - Cookie が無いか無効なら `401 unauthorized`。退会した ID の Cookie は `410 id_deleted`（`deleted_accounts` で判定）。画面は `410` で ID を捨てて新しい ID を受け取り、`401` で ID を取り直してから、要求をもう一度送る
  - 環境ごとに Cookie の名前、`iss`、公開鍵が違う（`wrangler.jsonc`）。ローカルは `localhost` で kan/game の `wrangler dev`、開発は `vegtab-dev.kan-game.app` で `dev.kan-game.app`、本番は `vegtab.kan-game.app` で `kan-game.app`
- **Origin:** 状態を変える要求は、`Origin` が `ALLOWED_ORIGINS` に含まれることを必須にする（Cookie は他サイトからの要求にも付くため）。違えば `403 forbidden_origin`。同じオリジンの `GET` は `Origin` を省けるので、`GET` では求めない
- **認証の順:** 認証の要る API は、ルートを引く前に Cookie と Origin を確かめる。無い API でも、ID の無い要求には `401` を返す
- **本文:** JSON。`Content-Type` が JSON（`application/json`、`application/*+json`、引数付き）でない本文は、空のオブジェクトとして検証する（必須の項目が無いので `400 invalid_request`）。JSON でないか、形が合わない本文は `400 invalid_request`。知らないフィールドは無視する
- **エラーの本文:** `{ error: "<コード>" }`。コードは英小文字と `_` で書く。主なコードは `invalid_request`、`invalid_date`、`invalid_replay`、`not_found`、`rate_limited`、`unauthorized`、`forbidden_origin`、`id_deleted`、`payload_too_large`、`internal_error`。画面は状態コードと、名前の登録の `name_taken` / `invalid_name` だけを読む。無い API は `404 not_found`。例外は `500 internal_error` にして、ログ（`unhandled_error`）に出す
- **パス:** 末尾の `/` は別のパスとして扱う（`/api/scores/` は `/api/scores` ではない）。`:name` の部分はデコードして使う。パスの照合の規則は画面と同じ（`src/core/path.ts`）
- **HEAD:** `GET` と同じ応答で、本文を返さない
- **応答のヘッダー（#120）:** 全ての応答に次の 3 つを付ける
  - `Content-Security-Policy: frame-ancestors 'none'; base-uri 'none'; form-action 'self'`（ほかのサイトの iframe に入れさせない）
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `/api/*` の応答（`/api/id/*` の中継を含む）には `Cache-Control: no-store`。ID ごとに違う応答を、途中のキャッシュに持たせないため
  - 本番以外は `X-Robots-Tag: noindex`（開発の `vegtab-dev.kan-game.app` を検索エンジンに載せない）
  - Static Assets の画面には `public/_headers` が、Worker のコードの応答（`/api/*`、`/s/*`）には `src/worker/lib/http.ts` の `withSecurityHeaders` が付ける（`_headers` は Worker の応答には当たらないため）

| API | 認証 | 内容 |
|---|---|---|
| `/api/id/*` | 不要 | ID 基盤の API（`session`、`transfer-codes` など）。Service Binding（`ID`）で ID 基盤へそのまま中継する。画面は起動時とオフラインからの復帰時に `POST /api/id/session` で ID を受け取り、延ばす |
| `GET /api/health` | 不要 | `{ status: "ok" }` |
| `GET /api/user/profile` | ID | `{ displayName }`。ランキングに公開している名前。同意の前は `null` |
| `POST /api/user/profile` | ID | 名前を登録し、公開に同意する（「名前の登録」） |
| `GET /api/seeds/daily` | ID | `{ seedId, seedValue, shareCode, date }`。今日のシード |
| `GET /api/seeds/daily/calendar?month=YYYY-MM` | ID | `{ seeds: [{ seedId, seedValue, shareCode, date, userScores }], firstDate }`。その月の、最初のデイリーの日から今日までの日（新しい順）と、それぞれの自分のベスト（`{ isCleared, moveCount, clearTimeMs, score }` か `null`）。月の形が違えば `400 invalid_month` |
| `GET /api/seeds/:id` | ID | `{ seedId, seedValue, shareCode, isDaily, dailyDate, best }` |
| `GET /api/seeds/by-value/:value` | ID | `{ seedValue, date }`。行のある日だけ。無ければ `404` |
| `GET /api/seeds/by-code/:code` | ID | `{ seedId, seedValue, shareCode }`。共有コードは大文字にして引く |
| `POST /api/scores` | ID | スコアを送る（「`POST /api/scores`」） |
| `GET /api/scores/my?seedId=` | ID | `{ scores: [{ id, seedId, seedValue, mode, moveCount, score, isCleared, clearTimeMs, createdAt }] }`。自分の記録の新しい順に 200 件まで |
| `GET /api/scores/:scoreId/replay` | ID | `{ replayLog, seed, finalScore, displayName }`。締め切り前は自分の記録だけ、締め切った後は全員の記録。見られなければ `404 not_found`、リプレイが無ければ `404 no_replay` |
| `GET /api/rankings/:seedId?mode=clear` | ID | ランキング（「ランキング」） |
| `GET /api/rankings/by-value/:seedValue?mode=clear` | ID | 同じ。シード値で引く |
| `GET /api/achievements` | ID | `{ achievements: [{ type, currentValue, isUnlocked, unlockedAt }] }`。定義にある全ての実績 |
| `POST /api/achievements/unlock` | ID | `{ type }`。端末で解除する実績（今は `tutorial_complete` だけ）。ほかは `400` |
| `POST /api/push/subscribe` | ID | `{ endpoint, keys: { p256dh, auth } }`。通知の購読を登録する。endpoint は 2048 文字以下で、知られた push サービスのものだけ。ID ごとに新しい 5 件まで残す。ほかの ID の endpoint は書き換えない |
| `DELETE /api/push/unsubscribe` | ID | `{ endpoint }`。自分の購読を消す |
| `GET /api/push/vapid-public-key` | ID | `{ publicKey }` |
| `POST /api/legacy/claim` | ID | 旧アカウントを引き継ぐ（「旧 URL からの引き継ぎ」） |
| `POST /api/legacy/handoff` | 旧トークン | 旧 URL の画面が呼ぶ（同上） |
| `POST /api/auth/refresh` | 不要 | 旧 URL の画面が、引き継ぎのために旧トークンを延ばす。`{ refreshToken }` → `{ accessToken, refreshToken }` |
| `GET /s/:seedId` | 不要 | 共有のリンク。ブラウザには `/puzzle/<seed_value>` への `302`、クローラーには OGP の meta だけの HTML。`:seedId` は seed の id か共有コード |
| `GET /s/:seedId/ogp.svg` | 不要 | OGP の画像（SVG。QR コードと最少のクリア手数） |

`mode` の引数と本文は、撤去したモードの名残で `clear` だけを受け付ける。

### `POST /api/scores`

```json
{
  "date": "2026-11-16",
  "mode": "clear",
  "clearTimeMs": 83500,
  "generatedItemTypes": ["scope", "v_cut"],
  "replayLog": [{ "type": "swap", "pos": { "row": 3, "col": 4 }, "dir": "up" }]
}
```

- 本文は 256 KiB まで。超えたら `413 payload_too_large`
- `date` は `YYYY-MM-DD` で、今日から 60 日前まで。範囲の外は `400 invalid_date`
- `replayLog` は 1〜1000 件。サーバーは送られた手数やスコアを読まず、`replayLog` をコアで再計算して手数、スコア、クリア、最大連鎖数を決める。再現できなければ `400 invalid_replay`
- `clearTimeMs` は 0 以上の整数か `null`（省略も可）。24 時間を超える値は弾かずに「時間の記録なし」（`null`）として保存する。クリアした記録にだけ残す。**時間は端末の申告値で、サーバーは検証しない**（DESIGN.md 4.3 節）
- `generatedItemTypes` は 20 文字以下の文字列で 10 件まで（省略は `[]`）。実績の判定にだけ使う
- 締め切った日（前日の猶予の 30 分を過ぎた日）は、記録せずに `200 { scoreId: null, shareCode, newAchievements: [], pastDate: true }` を返す。検証もしない
- ベストだけを持つ（upsert）。比較は DESIGN.md 3.7 節の順位と同じ。新しい記録が良ければ、リプレイを R2 へ置いて行を置き換え、旧いリプレイとランキングのキャッシュを消す。良くなければ R2 を使わずに返す
- 応答は `201 { scoreId, shareCode, newAchievements, verifiedScore, verifiedMoveCount }`
- 回数の制限（「回数の制限」）は、本文の検証の後、リプレイの検証の前に数える

### ランキング

`GET /api/rankings/:seedId` と `GET /api/rankings/by-value/:seedValue` → `{ ranking, userRank }`。

- `ranking`: `[{ rank, displayName, isSelf, score, moveCount, clearTimeMs, isCleared, scoreId? }]`。上位 100 件。並びと同じ順位は DESIGN.md 3.7 節
  - **ほかの人の ID は返さない**（kan-game.app のプライバシーポリシーが ID を公開しないと書いているため。#118）。自分の行かは Worker が Cookie の ID と比べて `isSelf` で返す
  - `scoreId` は、締め切り前は自分の行だけ、締め切った後は全員の行に付く（リプレイを開くため）
  - `score` は順位に使わない。今の画面は読まないが、Service Worker がキャッシュした古い画面が読むので返し続ける
- `userRank`: `{ rank, score, moveCount, clearTimeMs }` か `null`。名前や同意が無くても、自分の記録に順位を付けて返す
- 載るのは、名前と同意（`profiles`）のある ID の記録と、引き継がれていない旧アカウントの記録
- 結果は 5 分のあいだ KV でキャッシュする（`src/worker/lib/ranking-rule.ts` の `rankingCacheKey`）。キャッシュは ID を持つが、応答を作るとき外す。記録や名前が変わると消す。順位の規則やキャッシュの形を変えたら、キーの版を上げる
- 知らない seed には空のランキングを返し、キャッシュを作らない

### 名前の登録

`POST /api/user/profile` に `{ displayName, consent: true }` を送る。

- `displayName` は 1〜256 文字（UTF-16 の単位）の文字列。規則（見た目の 2〜20 文字など）と重複の判定は ID 基盤が持つ。`consent` は `true` でなければ `400`
- Worker が ID 基盤の `registerName` の RPC で登録してから、名前と同意を `profiles` に書き、ランキングのキャッシュを消す
- 名前が既にある ID（ここか別のゲームで決めた）は、その名前を変えずに同意だけを記録する。応答は `{ displayName }`
- 取られている名前は `409 name_taken`、規則に合わない名前は `400 invalid_name`、退会した ID は `410 id_deleted`

### 回数の制限

ID ごとに D1 の `rate_limits` で、固定の時間枠で数える（#119、`src/worker/lib/rate-limit.ts`）。超えたら `429 { error: "rate_limited" }` と `Retry-After`（秒）を返す。

| API | 上限 | 理由 |
|---|---|---|
| `POST /api/scores` | 60 秒に 10 件 | リプレイの検証が重い。断った送信は検証しない。締め切った日の送信は検証せずに答えるので数えない |
| `POST /api/user/profile` | 60 秒に 10 件 | ID 基盤の `registerName` を呼ぶ |

- 1 日 1 問で、詰んでからの再挑戦にも数十秒はかかるので、ふつうの遊び方では当たらない
- 数えないもの: 実績の解除（ホワイトリストの upsert だけ）、通知の登録（軽い D1 の書き込みだけ）、旧 URL の `/api/auth/refresh` と `/api/legacy/handoff`（旧トークンの署名を確かめるだけで、旧 URL を閉じるときに外す）
- 画面は 429 の送信をキューに残して送り直す（「送れなかったスコアのキュー」）
- 古い時間枠の行は毎日の定期実行で消す。退会でも消す

### 実績

- スコアの送信のときに、サーバーが送られた 1 ゲームの値（手数、クリア、最大連鎖数、作ったアイテム）と遊んだ日数で判定する。判定に使う値は `ACHIEVEMENT_DEFS`（`src/core/achievements.ts`）の各定義の `metric`
- 端末で決まる実績（チュートリアルの完了）は、`POST /api/achievements/unlock` のホワイトリストで解除する
- 連鎖の実績の type は `cascade_chain_*` のまま（Cascade のモードがあった頃の名前。解除済みの記録と対応させるため変えない）。後から足した 7 連鎖は `chain_7`
- #89 で足した段階の実績は、マイグレーション `0012_backfill_added_achievements.sql` が既存の行から移した（`clear_under_7` の最少手数、`cascade_chain_3` の最大連鎖数、`play_days_3` の日数）
- DB に残る撤去した実績（Sprint、Survival、Cascade の CP、「全モード制覇」）は返さない

### 退会

ID 基盤が `GAME_VEGTAB` の Service Binding で `GameService.deleteAccount(id)`（`src/worker/game-service.ts`）を呼ぶ。

- `deleted_accounts` に記録し、その ID の記録（`play_scores`、`achievements`、`push_subscriptions`、`profiles`、`legacy_claims`、`rate_limits`）と R2 のリプレイを消す。何度呼んでも同じ結果になる
- 退会の途中に書き込まれた行は、毎日の定期実行（`sweepDeletedAccounts`）が消す
- **記録を持つ表を足したら、`src/worker/lib/account.ts` の `ACCOUNT_TABLES` にも足す**

## 旧 URL からの引き継ぎ

`vegtab.app` の旧アカウント（端末に `deviceId` と JWT を置く方式）は、`vegtab.kan-game.app` の ID へ本人が引き継ぐ（#103）。同じ Worker と D1 が両方のホストを配信する。

- **旧 URL（`LEGACY_HOST` = `vegtab.app`）:** 画面は移転の案内だけを出す（`src/ui/legacy/`）。Worker は `/s/*` を新しい URL へ `301` で送り、`/api/health`、`/api/auth/refresh`、`/api/legacy/handoff` 以外の API に `410 { error: "moved", url }` を返す。旧アカウントは新しく作れず、書き込みも止まる
- **引き継ぎ:** 旧 URL の画面が、端末に残る旧トークンで `POST /api/legacy/handoff` を呼び、1 回限りのトークン（32 バイト、30 分、D1 にはハッシュだけ）を受け取る（`{ url }`）。新しい URL を `#handoff=<トークン>` 付きで開き、画面が確認を取ってから `POST /api/legacy/claim` に `{ token }` を送る（応答は `{ name }`）
  - トークンを URL のフラグメントに載せるのは、サーバーのログとリファラーに残さないため。画面は router が URL を読む前にフラグメントを消す（`src/ui/lib/handoffToken.ts`）
  - 確認を挟むのは、他人のリンクで気付かないまま記録を移されないようにするため
- **移すもの:** 旧アカウントの `play_scores` と `achievements` を、今の ID に付け替える。今の ID に同じシードの記録があれば、今の ID の記録を残す。実績は進み具合の良い方にまとめる。旧アカウントの名前は `registerName` で今の ID の名前として登録し、公開への同意も引き継ぐ（旧 URL でランキングに載せていたため）。取られている名前や規則に合わない名前は登録せず、画面が名前を決め直すよう求める。今の ID に名前があれば、その名前を使う
- **移した後:** 旧アカウントの `users` の行と、端末、トークン、購読の行を消し、`legacy_claims` に移した先を残す。同じ旧アカウントは 1 回しか引き継げない。旧 URL で再び引き継ぐと `409 claimed` になり、画面は新しい URL の引き継ぎコードを使うよう案内する
- **引き継がれない記録:** `users` に残る旧アカウントの記録は、過去日のランキングに旧 URL の名前（未設定なら NO NAME）でそのまま載る。消すと、ほかの参加者の順位が変わるため
- **移さないもの:** 端末の localStorage（送る前の記録、設定、プレイ中の盤面）。オリジンが変わり、新しい URL からは読めない
- **移行のときに捨てたもの（マイグレーション 0014）:** Clear 以外のモードの記録と、定義に無い実績。リプレイは全て（#106 で盤面の生成が変わり、旧い盤面では再生できないため）。移行の時点でまだ締め切っていないランキング（当日と、猶予の中の前日）の記録も捨てた。旧い盤面と新しい盤面の記録が混ざるため
  - R2 の旧いリプレイ（`replays/` の下）は、バケットのライフサイクルのルールで消す
- 旧 URL を閉じる手順は README の「ドメイン」

## D1

表はマイグレーション（`migrations/`）が作る。列の詳細はマイグレーションを正とする。各表の `user_id` は kan-game.app の ID。`vegtab.app` から引き継がれていない旧アカウントの行だけは、`users.id` を指す。

| 表 | 内容 |
|---|---|
| `puzzle_seeds` | シード。`seed_value` と `share_code`（6〜8 文字の英数字）は一意。デイリーは `is_daily` と `daily_date`（`YYYY-MM-DD`） |
| `play_scores` | 記録。`(user_id, seed_id, mode)` で一意で、ベストだけを持つ。`replay_log_key` は R2 のキー |
| `achievements` | 実績の進み具合。`(user_id, achievement_type)` で一意 |
| `profiles` | ランキングに載る ID。主キーは `account_id`。`display_name` は ID 基盤に登録した名前の写し、`consented_at` は公開に同意した時刻（ミリ秒） |
| `push_subscriptions` | 通知の購読。`endpoint` で一意 |
| `rate_limits` | 回数の制限。主キーは `(account_id, action)`（`action` は `score` / `profile`）。`window_start` は時間枠の始まり（ミリ秒） |
| `deleted_accounts` | 退会した ID。Cookie は最長 400 日有効なので残し続ける |
| `legacy_handoffs` | 旧 URL から新しい URL へ渡す 1 回限りのトークン。`token_hash`（SHA-256）、`expires_at`（ミリ秒） |
| `legacy_claims` | 引き継いだ旧アカウントと移した先 |
| `users` | `vegtab.app` の旧アカウント。引き継ぐと消える |
| `user_devices` / `transfer_codes` / `refresh_token_families` | 旧アカウントの端末、引き継ぎコード、リフレッシュトークン。旧 URL を閉じたら捨てる |

`play_scores` の列で注意の要るもの:

- `clear_time_ms`: クリアまでのその日の累計（ミリ秒、自己申告）。未クリアの記録と、時間を順位に入れる前の記録は `NULL`
- `mode`: 書くのは `clear` だけ。照会は全て `mode = 'clear'` で絞る。撤去したモードの行は 0014 で捨てた
- `move_limit` と `cascade_points`: 撤去したモード（Sprint / Cascade）の列で、今は書かない（既定値のまま）
- 使わない列（`mode`、`move_limit`、`cascade_points`）を消すマイグレーションは、コードの対応をデプロイした後に別で行う

変更はマイグレーションを足して行う。`npm run deploy` は未適用のマイグレーションを当ててから Worker を出すので、先に当てても今の Worker が壊れない形（表や列の追加）にする。消すことと名前を変えることは、コードの対応をデプロイした後の別のマイグレーションで行う。
