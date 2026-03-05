import {
  Cell, Color, ItemType, Position, Direction, Action,
  Match, ChainStep, GameState, BOARD_SIZE, NUM_COLORS,
} from './types.js';
import { createRng, nextInt } from './rng.js';
import {
  generateRawBoard, fillEmptyCells, cloneBoard, getCell, isValidPosition, nextColor,
} from './board.js';
import { findMatches, getUniquePositions, hasMatches } from './match.js';
import { applyGravity } from './gravity.js';
import {
  determineItem, determineItemFromMatches,
  getItemTargets, getSynthesisEffect, getSynthesisTargets,
  findCoffeeTargetColor, getCoffeeTargets,
  getScissorsTargets, getCutterTargets, getClipTargets,
} from './item.js';
import { calculateStepScore, getFullClearBonus } from './score.js';
import { isGameOver } from './gameOver.js';

/** 方向から隣接位置を計算 */
function getAdjacentPos(pos: Position, dir: Direction): Position {
  switch (dir) {
    case 'up': return { row: pos.row - 1, col: pos.col };
    case 'down': return { row: pos.row + 1, col: pos.col };
    case 'left': return { row: pos.row, col: pos.col - 1 };
    case 'right': return { row: pos.row, col: pos.col + 1 };
  }
}

/** 初期盤面を生成（自動消去込み、スコア0・アイテムなし） */
export function initializeGame(seed: number): GameState {
  let { board, rngState } = generateRawBoard(seed);

  // 自動消去ループ: マッチがなくなるまで繰り返す
  while (hasMatches(board)) {
    const matches = findMatches(board);
    const positions = getUniquePositions(matches);
    for (const pos of positions) {
      board[pos.row][pos.col] = null;
    }
    applyGravity(board);
    rngState = fillEmptyCells(board, rngState);
  }

  return {
    board,
    score: 0,
    rngState,
    moveCount: 0,
    undoUsed: false,
    isGameOver: false,
  };
}

/** GameStateのディープコピー（previousStateは含めない） */
export function cloneGameState(state: GameState): GameState {
  return {
    board: cloneBoard(state.board),
    score: state.score,
    rngState: state.rngState,
    moveCount: state.moveCount,
    undoUsed: state.undoUsed,
    isGameOver: state.isGameOver,
  };
}

/** アイテムを起動し、効果範囲の対象を消去・誘爆する */
function activateItem(
  board: (Cell | null)[][],
  pos: Position,
  item: ItemType,
  targetColor: number | undefined,
  chainIndex: number,
  rngState: number,
): { score: number; rngState: number; chainSteps: ChainStep[] } {
  const activated = new Set<string>();
  const chainSteps: ChainStep[] = [];
  let totalScore = 0;
  let rng = rngState;

  // 再帰的に誘爆を処理するキュー
  const queue: { pos: Position; item: ItemType; targetColor?: number }[] = [
    { pos, item, targetColor },
  ];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.pos.row},${current.pos.col}`;
    if (activated.has(key)) continue;
    activated.add(key);

    // アイテム自体を消去
    const cell = board[current.pos.row]?.[current.pos.col];
    if (cell?.item) {
      board[current.pos.row][current.pos.col] = null;
    }

    const targets = getItemTargets(board, current.pos, current.item, current.targetColor);
    const cleared: Position[] = [];

    for (const t of targets) {
      const tCell = board[t.row]?.[t.col];
      if (tCell === null) continue;
      if (tCell.item) {
        // 誘爆キューに追加
        const tKey = `${t.row},${t.col}`;
        if (!activated.has(tKey)) {
          queue.push({ pos: t, item: tCell.item });
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    if (cleared.length > 0) {
      const score = 10 * cleared.length * chainIndex;
      totalScore += score;
      chainSteps.push({
        chainIndex,
        matches: [],
        clearedPositions: cleared,
        generatedItems: [],
        score,
      });
    }
  }

  return { score: totalScore, rngState: rng, chainSteps };
}

/** コーヒー+アイテム合成: 対象色の全タイルからアイテム効果を発動 */
function activateCoffeeSynthesis(
  board: (Cell | null)[][],
  pos: Position,
  coffeePos: Position,
  otherItem: ItemType,
  targetColor: number,
  chainIndex: number,
  rngState: number,
): { score: number; rngState: number; chainSteps: ChainStep[] } {
  // まず両方のアイテムを消去
  board[pos.row][pos.col] = null;
  board[coffeePos.row][coffeePos.col] = null;

  // 対象色の全タイル位置を取得
  const colorTargets = getCoffeeTargets(board, targetColor);

  let totalScore = 0;
  let rng = rngState;
  const allSteps: ChainStep[] = [];
  const activated = new Set<string>();

  // 対象色タイルを消して、各位置からアイテム効果を発動
  for (const ct of colorTargets) {
    board[ct.row][ct.col] = null;
  }
  totalScore += 10 * colorTargets.length * chainIndex;

  // 各位置からアイテム効果を発動
  for (const ct of colorTargets) {
    let targets: Position[];
    switch (otherItem) {
      case 'scissors':
        targets = getScissorsTargets(ct);
        break;
      case 'cutter':
        targets = getCutterTargets(ct);
        break;
      case 'clip':
        targets = getClipTargets(ct, 2);
        break;
      default:
        targets = [];
    }

    const cleared: Position[] = [];
    for (const t of targets) {
      const cell = board[t.row]?.[t.col];
      if (cell === null) continue;
      if (cell.item) {
        // 誘爆
        const key = `${t.row},${t.col}`;
        if (!activated.has(key)) {
          activated.add(key);
          const result = activateItem(board, t, cell.item, undefined, chainIndex, rng);
          totalScore += result.score;
          rng = result.rngState;
          allSteps.push(...result.chainSteps);
        }
      } else {
        board[t.row][t.col] = null;
        cleared.push(t);
      }
    }

    if (cleared.length > 0) {
      totalScore += 10 * cleared.length * chainIndex;
    }
  }

  return { score: totalScore, rngState: rng, chainSteps: allSteps };
}

/** プレイヤーの操作を処理して新しいGameStateを返す */
export function processAction(state: GameState, action: Action): GameState {
  if (state.isGameOver) return state;

  const prevState = cloneGameState(state);
  const newState = cloneGameState(state);
  newState.previousState = prevState;
  const board = newState.board;

  if (action.type === 'tap') {
    // タップ: アイテム起動
    const cell = getCell(board, action.pos);
    if (!cell?.item) return state; // アイテムがなければ無効

    const item = cell.item;
    let targetColor: number | undefined;
    if (item === 'coffee') {
      targetColor = findCoffeeTargetColor(board, action.pos) ?? undefined;
      if (targetColor === undefined) return state;
    }

    const result = activateItem(board, action.pos, item, targetColor, 1, newState.rngState);
    newState.score += result.score;
    newState.rngState = result.rngState;
    newState.moveCount++;

    // 落下 → 補充 → 連鎖
    applyGravity(board);
    newState.rngState = fillEmptyCells(board, newState.rngState);
    const chainResult = processChains(board, newState.rngState, 2);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;

  } else {
    // スワイプ
    const targetPos = getAdjacentPos(action.pos, action.dir);
    if (!isValidPosition(targetPos)) return state;

    const cell1 = getCell(board, action.pos);
    const cell2 = getCell(board, targetPos);
    if (!cell1 || !cell2) return state;

    // アイテム合成チェック
    if (cell1.item && cell2.item) {
      const synthesis = getSynthesisEffect(cell1.item, cell2.item);
      if (synthesis) {
        const synthResult = processSynthesis(
          board, action.pos, targetPos, cell1.item, cell2.item,
          synthesis.effect, newState.rngState
        );
        newState.score += synthResult.score;
        newState.rngState = synthResult.rngState;
        newState.moveCount++;

        applyGravity(board);
        newState.rngState = fillEmptyCells(board, newState.rngState);
        const chainResult = processChains(board, newState.rngState, 2);
        newState.score += chainResult.score;
        newState.rngState = chainResult.rngState;

        newState.isGameOver = isGameOver(board);
        return newState;
      }
    }

    // アイテムとのスワイプ（アイテム起動）
    if (cell1.item || cell2.item) {
      const itemCell = cell1.item ? cell1 : cell2;
      const itemPos = cell1.item ? action.pos : targetPos;
      const otherCell = cell1.item ? cell2 : cell1;
      const otherPos = cell1.item ? targetPos : action.pos;

      // まず入れ替え
      board[action.pos.row][action.pos.col] = cell2;
      board[targetPos.row][targetPos.col] = cell1;

      let targetColor: number | undefined;
      if (itemCell.item === 'coffee') {
        // コーヒーのスワイプ: 入れ替え先の色
        targetColor = otherCell.item ? undefined : otherCell.color;
      }

      const result = activateItem(board, itemPos, itemCell.item!, targetColor, 1, newState.rngState);
      newState.score += result.score;
      newState.rngState = result.rngState;
      newState.moveCount++;

      applyGravity(board);
      newState.rngState = fillEmptyCells(board, newState.rngState);
      const chainResult = processChains(board, newState.rngState, 2);
      newState.score += chainResult.score;
      newState.rngState = chainResult.rngState;

      newState.isGameOver = isGameOver(board);
      return newState;
    }

    // 通常スワイプ: 入れ替えてマッチ判定
    board[action.pos.row][action.pos.col] = cell2;
    board[targetPos.row][targetPos.col] = cell1;

    const matches = findMatches(board);
    if (matches.length === 0) {
      // マッチなし: 入れ替えを戻す
      board[action.pos.row][action.pos.col] = cell1;
      board[targetPos.row][targetPos.col] = cell2;
      return state;
    }

    newState.moveCount++;

    // アイテム生成判定
    const itemGen = determineItemFromMatches(matches, action.pos);

    // マッチ消去
    const cleared = getUniquePositions(matches);
    for (const pos of cleared) {
      board[pos.row][pos.col] = null;
    }

    // スコア計算（1連鎖目）
    const stepScore = calculateStepScore(matches, 1);
    newState.score += stepScore;

    // アイテム配置
    if (itemGen) {
      board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };
    }

    // 落下 → 補充 → 連鎖
    applyGravity(board);
    newState.rngState = fillEmptyCells(board, newState.rngState);
    const chainResult = processChains(board, newState.rngState, 2);
    newState.score += chainResult.score;
    newState.rngState = chainResult.rngState;
  }

  newState.isGameOver = isGameOver(board);
  return newState;
}

/** 合成効果を処理 */
function processSynthesis(
  board: (Cell | null)[][],
  pos1: Position,
  pos2: Position,
  item1: ItemType,
  item2: ItemType,
  effect: string,
  rngState: number,
): { score: number; rngState: number } {
  let rng = rngState;
  let totalScore = 0;

  if (effect === 'coffee+coffee') {
    // 全消し: アイテムは残留
    const items: { pos: Position; item: ItemType }[] = [];
    // 合成元の2つは消える
    board[pos1.row][pos1.col] = null;
    board[pos2.row][pos2.col] = null;

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = board[row][col];
        if (cell === null) continue;
        if (cell.item) {
          items.push({ pos: { row, col }, item: cell.item });
          // アイテムはそのまま残る
        } else {
          board[row][col] = null;
        }
      }
    }

    // 全消しボーナス
    totalScore += getFullClearBonus();

    // 空きマスに補充（アイテム位置は残す）
    applyGravity(board);
    rng = fillEmptyCells(board, rng);

    return { score: totalScore, rngState: rng };
  }

  if (effect.startsWith('coffee+')) {
    const otherItem = effect.replace('coffee+', '') as ItemType;
    const coffeePos = item1 === 'coffee' ? pos1 : pos2;
    const otherPos = item1 === 'coffee' ? pos2 : pos1;

    // 隣接するセルの色を対象色とする
    // コーヒー合成時: 上隣から時計回りで色を探す
    const targetColor = findCoffeeTargetColor(board, coffeePos);
    if (targetColor === null) {
      board[pos1.row][pos1.col] = null;
      board[pos2.row][pos2.col] = null;
      return { score: 0, rngState: rng };
    }

    const result = activateCoffeeSynthesis(
      board, otherPos, coffeePos, otherItem, targetColor, 1, rng
    );
    totalScore += result.score;
    rng = result.rngState;

    return { score: totalScore, rngState: rng };
  }

  // 非コーヒー合成
  board[pos1.row][pos1.col] = null;
  board[pos2.row][pos2.col] = null;

  // 合成位置は最初のアイテム位置
  const synthPos = pos1;
  const targets = getSynthesisTargets(board, synthPos, effect);
  const cleared: Position[] = [];

  const activated = new Set<string>();
  activated.add(`${pos1.row},${pos1.col}`);
  activated.add(`${pos2.row},${pos2.col}`);

  for (const t of targets) {
    const cell = board[t.row]?.[t.col];
    if (cell === null) continue;
    if (cell.item) {
      const key = `${t.row},${t.col}`;
      if (!activated.has(key)) {
        activated.add(key);
        const result = activateItem(board, t, cell.item, undefined, 1, rng);
        totalScore += result.score;
        rng = result.rngState;
      }
    } else {
      board[t.row][t.col] = null;
      cleared.push(t);
    }
  }

  totalScore += 10 * cleared.length * 1;

  return { score: totalScore, rngState: rng };
}

/** 落下後の連鎖を処理 */
function processChains(
  board: (Cell | null)[][],
  rngState: number,
  startChain: number,
): { score: number; rngState: number; steps: ChainStep[] } {
  let rng = rngState;
  let totalScore = 0;
  const steps: ChainStep[] = [];
  let chainIndex = startChain;

  while (true) {
    const matches = findMatches(board);
    if (matches.length === 0) break;

    // アイテム生成（連鎖中は中央位置に配置）
    const itemGen = determineItemFromMatches(matches);

    // 消去
    const cleared = getUniquePositions(matches);
    for (const pos of cleared) {
      board[pos.row][pos.col] = null;
    }

    // スコア
    const stepScore = calculateStepScore(matches, chainIndex);
    totalScore += stepScore;

    // アイテム配置
    const generatedItems: { pos: Position; item: ItemType }[] = [];
    if (itemGen) {
      board[itemGen.pos.row][itemGen.pos.col] = { color: 0 as Color, item: itemGen.item };
      generatedItems.push(itemGen);
    }

    steps.push({
      chainIndex,
      matches,
      clearedPositions: cleared,
      generatedItems,
      score: stepScore,
    });

    chainIndex++;

    // 落下 → 補充
    applyGravity(board);
    rng = fillEmptyCells(board, rng);
  }

  return { score: totalScore, rngState: rng, steps };
}

/** Undo処理 */
export function undoAction(state: GameState): GameState | null {
  if (state.undoUsed || !state.previousState) return null;
  const restored = cloneGameState(state.previousState);
  restored.undoUsed = true;
  return restored;
}
