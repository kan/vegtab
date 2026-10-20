# E2Eテスト設計書

## 技術選定

- **フレームワーク:** Playwright
- **理由:** Vue.js + Cloudflare Workers 環境との相性、クロスブラウザ対応、`page.route()` による API モック

## ディレクトリ構成

```
frontend/e2e/
├── flows/          # ユーザーフロー
│   ├── clear.spec.ts
│   └── daily.spec.ts
├── interactions/   # 操作系
│   ├── drag.spec.ts
│   ├── items.spec.ts
│   └── synthesis.spec.ts
├── auth/           # 認証
│   ├── register.spec.ts
│   └── token-refresh.spec.ts
├── fixtures/       # テストデータ・シード
└── helpers/        # ユーティリティ
    ├── board-utils.ts
    └── api-mock.ts
```

## テストシナリオ（12件）

### フロー系

1. **クリアフロー:** おじゃま全除去 → クリア判定 → スコア送信 → ランキング表示
2. **失敗フロー:** 詰み → 失敗表示
3. **デイリーシード:** ロード → プレイ → 結果表示

### 操作系

4. **ドラッグ＆スワップ:** マッチ → 連鎖アニメーション
5. **アイテム発動:** アイテム生成 → タップ発動（ハサミ/食器セット/サラダボウル）
6. **合成発動:** 代表5パターン（line+line, burst+burst, flush+flush, scope+burst, scope+flush）
7. **スプーン:** タップ → 周囲消去 → 任意マス選択

### 認証・通信系

8. **認証フロー:** 匿名登録 → トークンリフレッシュ
9. **シェアフロー:** スコア → シェアボタン → URL生成
10. **オフラインフォールバック:** API断 → localStorage で動作継続

### その他

11. **過去のデイリー:** カレンダーから過去日を選択 → 案内表示 → プレイ（ランキングに記録されない）
12. **レスポンシブ:** モバイル / タブレット / デスクトップの表示確認

## 決定的テスト戦略

エンジンはシード値ベースの擬似乱数を使用しているため、固定シード値で盤面を再現可能。

- **シード `42`:** 標準的な盤面（基本フローのテスト用）
- **シード `999`:** エッジケース検証用

テスト内でシード値を固定し、期待される盤面状態をアサーションする。

## API モック戦略

Playwright の `page.route()` で Workers API をインターセプトし、フロントエンド単体でテスト可能にする。

```typescript
// helpers/api-mock.ts
export async function mockDailySeed(page: Page, seed: string) {
  await page.route('**/api/seeds/daily', (route) =>
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        id: 'test-seed-id',
        seedValue: seed,
        shareCode: 'TEST01',
        dailyDate: '2026-01-01',
      }),
    })
  );
}

export async function mockScoreSubmit(page: Page) {
  await page.route('**/api/scores', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ success: true }) })
  );
}
```

## ボードユーティリティ

```typescript
// helpers/board-utils.ts
export async function performSwap(
  page: Page,
  from: { row: number; col: number },
  to: { row: number; col: number },
) {
  const cellSize = 50; // CSS に依存
  const boardEl = page.locator('.puzzle-board');
  const box = await boardEl.boundingBox();
  if (!box) throw new Error('Board not found');

  const fromX = box.x + from.col * cellSize + cellSize / 2;
  const fromY = box.y + from.row * cellSize + cellSize / 2;
  const toX = box.x + to.col * cellSize + cellSize / 2;
  const toY = box.y + to.row * cellSize + cellSize / 2;

  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 5 });
  await page.mouse.up();
}

export async function getCellValue(
  page: Page,
  row: number,
  col: number,
): Promise<string | null> {
  return page.locator(`.cell[data-row="${row}"][data-col="${col}"]`).getAttribute('data-type');
}
```

## 実装ロードマップ

### Phase 1: 基盤整備

- Playwright インストール・設定（`playwright.config.ts`）
- ヘルパー・フィクスチャ作成
- CI パイプライン設定（GitHub Actions）

### Phase 2: クリティカルパス

- ゲームフロー（クリア / 失敗）
- ドラッグ操作・マッチ判定
- デイリーシードのロード

### Phase 3: 機能テスト

- アイテム生成・発動
- 合成（代表パターン）
- スプーン操作
- ランキング・シェア

### Phase 4: エッジケース

- オフラインフォールバック
- トークン期限切れ・リフレッシュ
- 詰み判定
- レスポンシブ表示
