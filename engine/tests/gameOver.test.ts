import { describe, it, expect } from 'vitest';
import { hasValidSwap } from '../src/gameOver.js';
import { Cell, Color, BOARD_SIZE } from '../src/types.js';

/**
 * 3色ローテーション（(r+c)%3）で構築したデッド盤面。
 * どの隣接スワップでも横3連・縦3連・2x2マッチが成立しない。
 */
function makeDeadBoard(): (Cell | null)[][] {
  return Array.from({ length: BOARD_SIZE }, (_, r) =>
    Array.from({ length: BOARD_SIZE }, (_, c) => ({
      color: ((r + c) % 3) as Color,
    }))
  );
}

describe('hasValidSwap: おじゃまタイルとのスワップ判定', () => {
  it('おじゃまと通常タイルを入れ替えるとマッチが成立する盤面で true を返す（横3連）', () => {
    const board = makeDeadBoard();
    // デッド盤面の行0: [0, 1, 2, 0, 1, 2, 0, 1]
    // 列2をおじゃまにし、列3を色2に変更する。
    // obs(0,2) と (0,3)=色2 を入れ替えると:
    //   (0,0)=0, (0,1)=1, (0,2)=色2, (0,3)=obs → マッチなし（012はバラバラ）
    //
    // 別のアプローチ: 列0,1 を色0に揃え、列2をおじゃまにし、列3を色0にする。
    //   obs(0,2) と (0,3)=色0 を入れ替えると:
    //   (0,0)=0, (0,1)=0, (0,2)=色0 → 横3連マッチ!
    board[0][0] = { color: 0 as Color };
    board[0][1] = { color: 0 as Color };
    board[0][2] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[0][3] = { color: 0 as Color };

    expect(hasValidSwap(board)).toBe(true);
  });

  it('おじゃまと通常タイルを入れ替えるとマッチが成立する盤面で true を返す（縦3連）', () => {
    const board = makeDeadBoard();
    // 列0の行0,1 を色0に揃え、行2をおじゃまにし、行3を色0にする。
    // obs(2,0) と (3,0)=色0 を入れ替えると:
    //   (0,0)=0, (1,0)=0, (2,0)=色0 → 縦3連マッチ!
    board[0][0] = { color: 0 as Color };
    board[1][0] = { color: 0 as Color };
    board[2][0] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[3][0] = { color: 0 as Color };

    expect(hasValidSwap(board)).toBe(true);
  });

  it('おじゃまと通常タイルの入れ替えでマッチ不成立なら false を返す', () => {
    const board = makeDeadBoard();
    // デッド盤面の(3,3)=色0 をおじゃまに変更する。
    // おじゃまの隣の通常タイルと入れ替えても、デッド盤面の色配置では
    // 3連が成立しない。
    // (3,3) のデッド値: (3+3)%3 = 0
    // 隣接: (3,2)=(3+2)%3=2, (3,4)=(3+4)%3=1, (2,3)=(2+3)%3=2, (4,3)=(4+3)%3=1
    // 入れ替え例: obs(3,3) と (3,4)=色1 →
    //   (3,3)=色1, (3,4)=obs, (3,2)=色2, (3,5)=(3+5)%3=2 → 1,2 でマッチなし
    board[3][3] = { color: 0 as Color, obstacle: { durability: 1 } };

    expect(hasValidSwap(board)).toBe(false);
  });

  it('おじゃまとアイテム（v_cut）が隣接していれば true を返す', () => {
    const board = makeDeadBoard();
    board[4][4] = { color: 0 as Color, obstacle: { durability: 2 } };
    board[4][5] = { color: 1 as Color, item: 'v_cut' };
    expect(hasValidSwap(board)).toBe(true);
  });

  it('おじゃまとアイテム（h_cut）が隣接していれば true を返す', () => {
    const board = makeDeadBoard();
    board[2][3] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[2][4] = { color: 1 as Color, item: 'h_cut' };
    expect(hasValidSwap(board)).toBe(true);
  });

  it('おじゃまとアイテム（burst）が隣接していれば true を返す', () => {
    const board = makeDeadBoard();
    board[5][5] = { color: 0 as Color, obstacle: { durability: 3 } };
    board[5][6] = { color: 1 as Color, item: 'burst' };
    expect(hasValidSwap(board)).toBe(true);
  });

  it('おじゃまとアイテム（flush）が隣接していれば true を返す', () => {
    const board = makeDeadBoard();
    board[6][6] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[6][7] = { color: 1 as Color, item: 'flush' };
    expect(hasValidSwap(board)).toBe(true);
  });

  it('おじゃまと scope のみの場合は false を返す（scope はスワップ不可）', () => {
    // scope は特殊アイテムでおじゃまとのスワップは不可だが、
    // scope は通常タイルとのスワップは有効（行44-45「アイテムとの入れ替えは有効」）。
    // そのため scope の隣に通常タイルがあると true になってしまう。
    // テスト意図を正確に表現するため、scope の全隣接をおじゃまで囲む。
    const board = makeDeadBoard();
    // (0,0) に scope、(0,1) と (1,0) をおじゃまにする（角なので隣接は2方向のみ）
    board[0][0] = { color: 0 as Color, item: 'scope' };
    board[0][1] = { color: 1 as Color, obstacle: { durability: 1 } };
    board[1][0] = { color: 1 as Color, obstacle: { durability: 1 } };

    expect(hasValidSwap(board)).toBe(false);
  });

  it('おじゃま同士のみの隣接では false を返す', () => {
    // 全セルをおじゃまタイルにする
    const board: (Cell | null)[][] = Array.from({ length: BOARD_SIZE }, () =>
      Array.from({ length: BOARD_SIZE }, () => ({
        color: 0 as Color,
        obstacle: { durability: 1 },
      }))
    );
    expect(hasValidSwap(board)).toBe(false);
  });

  it('おじゃまと scope が隣接し、他に有効な手がない盤面で false を返す', () => {
    const board = makeDeadBoard();
    // 角にスコープを配置し、隣接を全ておじゃまで囲む
    // 左上角: (0,0)=scope, (0,1)=obs, (1,0)=obs
    board[0][0] = { color: 0 as Color, item: 'scope' };
    board[0][1] = { color: 1 as Color, obstacle: { durability: 1 } };
    board[1][0] = { color: 1 as Color, obstacle: { durability: 1 } };
    // 右下角: (7,7)=scope, (7,6)=obs, (6,7)=obs
    board[7][7] = { color: 0 as Color, item: 'scope' };
    board[7][6] = { color: 1 as Color, obstacle: { durability: 2 } };
    board[6][7] = { color: 1 as Color, obstacle: { durability: 2 } };

    expect(hasValidSwap(board)).toBe(false);
  });

  it('おじゃまタイルが盤面に存在しない場合は通常の判定に委譲される', () => {
    // 3色ローテーションのデッド盤面（おじゃまなし）: 有効手なし
    const board = makeDeadBoard();
    expect(hasValidSwap(board)).toBe(false);
  });

  it('おじゃまの入れ替え方向が逆（左・上方向）でも正しく検出される', () => {
    const board = makeDeadBoard();
    // hasValidSwap は右と下のみ走査するが、入れ替え自体は対称なので
    // 右方向走査で (col, col+1) を試すことで (col+1)→(col) の逆方向もカバーされる
    //
    // 行0: [..., 色0, obs, 色0, 色0]
    // obs(0,5) を (0,6)=色0 と入れ替えると (0,5)=色0 となり
    // (0,6),(0,7) の色0 と合わせて (0,5),(0,6),(0,7) で横3連マッチ
    board[0][5] = { color: 0 as Color, obstacle: { durability: 1 } };
    board[0][6] = { color: 0 as Color };
    board[0][7] = { color: 0 as Color };

    expect(hasValidSwap(board)).toBe(true);
  });

  it('複数のおじゃまが盤面に散在し、そのうち1つが通常タイルとのスワップでマッチ成立', () => {
    const board = makeDeadBoard();
    // おじゃま1: マッチ不成立の位置
    board[3][3] = { color: 0 as Color, obstacle: { durability: 2 } };
    // おじゃま2: マッチ不成立の位置
    board[5][5] = { color: 0 as Color, obstacle: { durability: 1 } };
    // おじゃま3: マッチ成立する位置
    // 行7: 列5,6 を色0にし、列7をおじゃまに。列7 の右端なので走査は列6→列7。
    // ただし列7は右端なのでそこから右はない。列6→列7で入れ替え:
    //   (7,6)=obs, (7,7)=色0 → (7,6)=色0 → (7,5)=色0, (7,6)=色0 → 2連のみ
    // 代わりに行7の列4,5,6を使う:
    //   (7,4)=色0, (7,5)=色0, (7,6)=obs, (7,7)=色0
    //   obs(7,6) と (7,7)=色0 を入れ替え → (7,6)=色0 → (7,4)=0,(7,5)=0,(7,6)=0 → 3連!
    // ただし(7,4)のデッド値は(7+4)%3=2, (7,5)は(7+5)%3=0 なので上書きが必要
    board[7][4] = { color: 0 as Color };
    board[7][5] = { color: 0 as Color };
    board[7][6] = { color: 0 as Color, obstacle: { durability: 3 } };
    board[7][7] = { color: 0 as Color };

    expect(hasValidSwap(board)).toBe(true);
  });
});
