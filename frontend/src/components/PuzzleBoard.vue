<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, triggerRef } from 'vue';
import { useI18n } from 'vue-i18n';
import { usePuzzleStore, type ItemAnimPlan, type ChainAnimData, type SynthesisAnimPlan } from '@/stores/puzzle';
import { BOARD_SIZE, cloneBoard, getSynthesisEffect, type Position, type Direction, type Cell, type ItemType } from '@tomado/engine';
import { useScopeSelection } from '@/composables/useMagGlassSelection';
import { useDragHandler, pk, adj } from '@/composables/useDragHandler';
import { playSE, vibrate } from '@/sound';
import ItemIcon from './ItemIcon.vue';
import VegetableIcon from './VegetableIcon.vue';
import ObstacleTile from './ObstacleTile.vue';
import type DebugPanel from './DebugPanel.vue';

const props = defineProps<{
  debugPanel?: InstanceType<typeof DebugPanel> | null;
}>();

const { t } = useI18n();
const store = usePuzzleStore();
const wrapperEl = ref<HTMLElement | null>(null);
const boardEl = ref<HTMLElement | null>(null);
const cellSize = ref(0);

// --- Scope selection ---
const scope = useScopeSelection();

// Vegetable colors for check-overlay
const VEGGIE_COLORS = ['#d4b828', '#4a9a4e', '#7B4FAA', '#c85a5a', '#8a8a7a'];

/** Animation timing constants (ms) */
const ANIM = {
  SWAP: 150,
  MATCH_SHOW: 350,
  CLEAR: 250,
  DROP: 300,
  CELL_SWEEP_INTERVAL: 40,
  ITEM_CLEAR: 150,
} as const;

// --- Layout ---
onMounted(() => { updateCellSize(); window.addEventListener('resize', updateCellSize); });
onUnmounted(() => window.removeEventListener('resize', updateCellSize));

function updateCellSize() {
  if (wrapperEl.value) {
    cellSize.value = Math.floor(Math.min(wrapperEl.value.clientWidth, wrapperEl.value.clientHeight) / BOARD_SIZE);
  }
}
const boardSize = computed(() => cellSize.value * BOARD_SIZE);

// --- Visual board ---
const visualBoard = ref<(Cell | null)[][] | null>(null);
const activeBoard = computed(() => visualBoard.value ?? store.board);

function vbRemove(pos: Position) {
  if (!visualBoard.value) return;
  visualBoard.value[pos.row][pos.col] = null;
  triggerRef(visualBoard);
}

// --- Match/clear animation state ---
const matchedCells = reactive(new Set<string>());
const clearingCells = reactive(new Set<string>());

// --- Obstacle destruction animation state ---
const obstacleClearingCells = reactive(new Set<string>());
const obstacleDamagedCells = reactive(new Set<string>());

// --- Item effect animation state ---
const itemClearingCells = reactive(new Set<string>());
const sweepIcon = ref<{ item: string; x: number; y: number; size: number } | null>(null);
const sweepTransition = ref(false);
const cellItemOverlay = reactive(new Map<string, string>());

// --- Drop animation state ---
const dropOffsets = reactive<Record<string, number>>({});
const dropTransitioning = ref(false);

// --- Screen shake ---
const shaking = ref(false);

// --- Scope tap hint ---
const showScopeTapHint = ref(false);
const scopeTapHintText = ref('');
let scopeHintTimer: ReturnType<typeof setTimeout> | undefined;

function showScopeHint(key: string) {
  clearTimeout(scopeHintTimer);
  scopeTapHintText.value = t(`puzzle.${key}`);
  showScopeTapHint.value = true;
  scopeHintTimer = setTimeout(() => { showScopeTapHint.value = false; }, 3000);
}

// --- Drag handling ---
const drag = useDragHandler(cellSize, boardEl, commitSwap, handleTap);
const { cellOffsets, getOff, setOff, clearOff } = drag;

function onPointerUpWithDebug(e: PointerEvent) {
  drag.onPointerUp(e, (pos) => {
    // Debug panel intercept
    return !!(props.debugPanel?.isPlacing && props.debugPanel.handleCellTap(pos.row, pos.col));
  });
}

// --- Utilities ---
function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function nextFrame() { return new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))); }

// --- Tap ---
async function handleTap(pos: Position) {
  // Scope cell selection mode
  if (scope.scopeSelecting.value) {
    handleScopeSelection(pos);
    return;
  }

  // Check if tapping a scope → enter selection mode
  const cell = activeBoard.value?.[pos.row]?.[pos.col];
  if (cell?.item === 'scope') {
    scope.startSelection(pos);
    clearOff(pos.row, pos.col);
    showScopeHint('scopeTapHint');
    return;
  }

  const plan = store.computeItemTapPlan(pos);
  if (!plan) { store.tap(pos); return; }

  drag.setLocked(true);
  clearOff(pos.row, pos.col);
  visualBoard.value = plan.boardBeforeActivation;

  await animateItemEffects(plan);
  await animateDropAndChains(plan);

  store.applyState(plan.finalState);
  visualBoard.value = null;
  drag.setLocked(false);
}

async function handleScopeSelection(pos: Position) {
  const result = scope.selectCell(pos);
  if (!result) return;
  showScopeTapHint.value = false;

  if (result.synthesis) {
    await animateScopeSynthesis(result.synthesis.pos1, result.synthesis.pos2, result.cells);
  } else {
    await animateScope(result.source, result.cells);
  }
}

function cancelScopeSelection() {
  scope.cancelSelection();
  visualBoard.value = null;
  showScopeTapHint.value = false;
}

async function animateScope(scopePos: Position, targetCells: Position[]) {
  // If visualBoard is set (e.g. from a swap), apply the swapped board to the store
  // so computeScopePlan sees the correct board. Save original state for undo.
  let originalState: typeof store.gameState = null;
  if (visualBoard.value !== null) {
    originalState = store.gameState ? { ...store.gameState } : null;
    const swappedState = { ...store.gameState!, board: cloneBoard(visualBoard.value!) };
    store.applyState(swappedState);
    visualBoard.value = null;
  }

  const plan = store.computeScopePlan(scopePos, targetCells);
  if (!plan) {
    // Fallback: apply instantly
    if (originalState) store.applyState(originalState);
    store.activateScope(scopePos, targetCells);
    return;
  }

  drag.setLocked(true);
  playSE('item_use'); vibrate(20);

  // Build a board with the scope removed but targets still present
  const boardWithoutScope = cloneBoard(store.board!);
  boardWithoutScope[scopePos.row][scopePos.col] = null;
  visualBoard.value = boardWithoutScope;

  // 1) 周囲上下左右4マスを消去アニメーション
  const adjNonItem = plan.adjacentTargets.filter(t => {
    const cell = boardWithoutScope[t.row]?.[t.col];
    return cell && !cell.item;
  });
  if (adjNonItem.length > 0) {
    await animateRadial(scopePos, adjNonItem, 'scope');
    for (const t of adjNonItem) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  // 2) ユーザー選択マスの消去アニメーション（SE + scopeオーバーレイ点滅）
  for (const target of targetCells) {
    const tc = visualBoard.value?.[target.row]?.[target.col];
    if (!tc) continue;
    playSE('item_use'); vibrate(15);
    // scopeアイコンを点滅オーバーレイ
    const key = pk(target.row, target.col);
    cellItemOverlay.set(key, 'scope');
    await wait(120);
    cellItemOverlay.delete(key);
    await wait(60);
    cellItemOverlay.set(key, 'scope');
    await wait(120);
    itemClearingCells.add(key);
    vbRemove(target);
    await wait(ANIM.ITEM_CLEAR);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  // Switch to board after clear
  visualBoard.value = plan.boardAfterClear;

  // Animate item detonations if any
  for (const effect of plan.itemEffects) {
    vbRemove(effect.itemPos);
    await animateSingleEffect(effect.itemType, effect.itemPos, effect.targets);
    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  // Drop animation
  const cs = cellSize.value;
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const e of plan.newTileEntries) dropOffsets[pk(e.row, e.col)] = -e.segNulls * cs;
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const keys = Object.keys(dropOffsets);
  for (const k of keys) dropOffsets[k] = 0;
  await wait(ANIM.DROP);
  dropTransitioning.value = false;
  for (const k of keys) delete dropOffsets[k];

  // Regular chains
  for (const chain of plan.regularChains) await animateChainStep(chain);

  store.applyState(plan.finalState);
  visualBoard.value = null;
  drag.setLocked(false);
}

async function animateScopeSynthesis(pos1: Position, pos2: Position, targetCells: Position[]) {
  const plan = store.computeScopeSynthesisPlan(pos1, pos2, targetCells);
  if (!plan) {
    // Fallback: apply instantly
    store.applyScopeSynthesis(pos1, pos2, targetCells);
    return;
  }

  drag.setLocked(true);
  playSE('item_use'); vibrate(20);

  // Remove both items from visual board
  const boardWithoutItems = cloneBoard(store.board!);
  boardWithoutItems[pos1.row][pos1.col] = null;
  boardWithoutItems[pos2.row][pos2.col] = null;
  visualBoard.value = boardWithoutItems;

  // 両位置の周囲4マス消去アニメーション
  const adjNonItem = plan.adjacentTargets.filter(t => {
    const cell = boardWithoutItems[t.row]?.[t.col];
    return cell && !cell.item;
  });
  if (adjNonItem.length > 0) {
    await animateRadial(pos1, adjNonItem, 'scope');
    for (const t of adjNonItem) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  if (plan.synthEffect === 'scope+scope') {
    // scope+scope: show scope overlay on 3 selected cells, then clear
    const remaining = plan.effectTargets.filter(t => visualBoard.value?.[t.row]?.[t.col]);
    if (remaining.length > 0) {
      await animateRadial(pos1, remaining, 'scope');
      for (const t of remaining) vbRemove(t);
      itemClearingCells.clear();
      cellItemOverlay.clear();
    }
  } else if (plan.synthEffect === 'scope+v_cut') {
    await animateVCut(targetCells[0], plan.effectTargets);
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  } else if (plan.synthEffect === 'scope+h_cut') {
    await animateHCut(targetCells[0], plan.effectTargets);
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  } else if (plan.synthEffect === 'scope+burst') {
    await animateRadial(targetCells[0], plan.effectTargets, 'burst');
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  visualBoard.value = plan.boardAfterClear;

  // Animate item detonations if any
  for (const effect of plan.itemEffects) {
    vbRemove(effect.itemPos);
    await animateSingleEffect(effect.itemType, effect.itemPos, effect.targets);
    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  // Drop animation
  const cs = cellSize.value;
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const e of plan.newTileEntries) dropOffsets[pk(e.row, e.col)] = -e.segNulls * cs;
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const keys = Object.keys(dropOffsets);
  for (const k of keys) dropOffsets[k] = 0;
  await wait(ANIM.DROP);
  dropTransitioning.value = false;
  for (const k of keys) delete dropOffsets[k];

  // Regular chains
  for (const chain of plan.regularChains) await animateChainStep(chain);

  store.applyState(plan.finalState);
  visualBoard.value = null;
  drag.setLocked(false);
}

// --- Swap ---
async function commitSwap(pos: Position, dir: Direction) {
  drag.setLocked(true);
  const cs = cellSize.value;
  const nb = adj(pos, dir);
  const fullX = (nb.col - pos.col) * cs, fullY = (nb.row - pos.row) * cs;

  // Slide
  playSE('swap'); vibrate(10);
  setOff(pos.row, pos.col, fullX, fullY, true, 10);
  setOff(nb.row, nb.col, -fullX, -fullY, true, 0);
  await wait(ANIM.SWAP);

  // Try normal swap
  const swapPlan = store.computeSwapPlan(pos, dir);
  if (swapPlan) {
    clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
    visualBoard.value = swapPlan.boardAfterSwap;
    for (const chain of swapPlan.chains) await animateChainStep(chain);
    store.applyState(swapPlan.finalState);
    visualBoard.value = null;
    drag.setLocked(false);
    return;
  }

  // Scope swap with regular tile → enter selection mode
  {
    const cell1 = activeBoard.value?.[pos.row]?.[pos.col];
    const cell2 = activeBoard.value?.[nb.row]?.[nb.col];
    if (cell1 && cell2) {
      const scopeCell = cell1.item === 'scope' ? cell1 : cell2.item === 'scope' ? cell2 : null;
      if (scopeCell && !(cell1.item && cell2.item)) {
        // One is scope, the other is a regular tile (not both items)
        // After slide animation, mag moved to the neighbor's position
        const scopePos = cell1.item === 'scope' ? nb : pos;
        clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
        // Show the swapped board visually
        const swapped = cloneBoard(store.board!);
        swapped[pos.row][pos.col] = cell2;
        swapped[nb.row][nb.col] = cell1;
        visualBoard.value = swapped;
        scope.startSelection(scopePos);
        showScopeHint('scopeTapHint');
        drag.setLocked(false);
        return;
      }
    }
  }

  // Try item swap
  const itemSwap = store.computeItemSwapPlan(pos, dir);
  if (itemSwap) {
    clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
    visualBoard.value = itemSwap.boardAfterSwap;
    await wait(50);
    // Reassign for item effects
    visualBoard.value = itemSwap.plan.boardBeforeActivation;
    await animateItemEffects(itemSwap.plan);
    await animateDropAndChains(itemSwap.plan);
    store.applyState(itemSwap.plan.finalState);
    visualBoard.value = null;
    drag.setLocked(false);
    return;
  }

  // Scope synthesis (needs user selection)
  {
    const cell1 = activeBoard.value?.[pos.row]?.[pos.col];
    const cell2 = activeBoard.value?.[nb.row]?.[nb.col];
    if (cell1?.item && cell2?.item) {
      const hasScope = cell1.item === 'scope' || cell2.item === 'scope';
      if (hasScope) {
        const synth = getSynthesisEffect(cell1.item, cell2.item);
        if (synth && ['scope+scope', 'scope+v_cut', 'scope+h_cut', 'scope+burst'].includes(synth.effect)) {
          clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
          scope.startSelection(pos, synth.effect === 'scope+scope' ? 3 : 1, { pos1: pos, pos2: nb });
          const synthHintMap: Record<string, string> = {
            'scope+scope': 'scopeScopeSynthHint',
            'scope+v_cut': 'scopeVCutSynthHint',
            'scope+h_cut': 'scopeHCutSynthHint',
            'scope+burst': 'scopeBurstSynthHint',
          };
          showScopeHint(synthHintMap[synth.effect] ?? 'scopeTapHint');
          drag.setLocked(false);
          return;
        }
      }
    }
  }

  // Synthesis
  const synthPlan = store.computeSynthesisPlan(pos, dir);
  if (synthPlan) {
    clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
    visualBoard.value = synthPlan.boardAfterSwap;
    await wait(50);
    visualBoard.value = synthPlan.boardBeforeActivation;
    await animateSynthesisEffects(synthPlan);
    await animateSynthesisDropAndChains(synthPlan);
    store.applyState(synthPlan.finalState);
    visualBoard.value = null;
    drag.setLocked(false);
    return;
  }

  // Invalid → bounce back
  setOff(pos.row, pos.col, 0, 0, true, 0);
  setOff(nb.row, nb.col, 0, 0, true, 0);
  await wait(ANIM.SWAP);
  clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
  drag.setLocked(false);
}

// --- Item effect animations ---

async function animateSingleEffect(itemType: ItemType, pos: Position, targets: Position[]) {
  switch (itemType) {
    case 'scope': await animateRadial(pos, targets, 'scope'); break;
    case 'v_cut': await animateVCut(pos, targets); break;
    case 'h_cut': await animateHCut(pos, targets); break;
    case 'burst': await animateRadial(pos, targets, 'burst'); break;
    case 'flush': await animateFlush(pos, targets); break;
  }
}

async function animateItemEffects(plan: ItemAnimPlan) {
  for (const effect of plan.effects) {
    playSE('item_use'); vibrate(20);
    vbRemove(effect.itemPos);
    await animateSingleEffect(effect.itemType, effect.itemPos, effect.targets);
    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }
}

async function animateVCut(pos: Position, targets: Position[]) {
  // Top to bottom: overlay v_cut icon on each target cell sequentially
  const col = pos.col;
  const sorted = [...targets].filter(t => t.col === col).sort((a, b) => a.row - b.row);

  for (const t of sorted) {
    cellItemOverlay.set(pk(t.row, t.col), 'v_cut');
    itemClearingCells.add(pk(t.row, t.col));
    await wait(ANIM.CELL_SWEEP_INTERVAL);
  }

  await wait(ANIM.ITEM_CLEAR + 100);
}

async function animateHCut(pos: Position, targets: Position[]) {
  // Left to right: overlay h_cut icon on each target cell sequentially
  const row = pos.row;
  const sorted = [...targets].filter(t => t.row === row).sort((a, b) => a.col - b.col);

  for (const t of sorted) {
    cellItemOverlay.set(pk(t.row, t.col), 'h_cut');
    itemClearingCells.add(pk(t.row, t.col));
    await wait(ANIM.CELL_SWEEP_INTERVAL);
  }

  await wait(ANIM.ITEM_CLEAR + 100);
}

async function animateRadial(pos: Position, targets: Position[], icon: ItemType) {
  // Sort by distance from center (radial expansion)
  const sorted = [...targets].sort((a, b) => {
    const da = Math.abs(a.row - pos.row) + Math.abs(a.col - pos.col);
    const db = Math.abs(b.row - pos.row) + Math.abs(b.col - pos.col);
    return da - db;
  });

  // Show overlay on targets in waves
  let prevDist = -1;
  for (const t of sorted) {
    const dist = Math.abs(t.row - pos.row) + Math.abs(t.col - pos.col);
    if (dist > prevDist) {
      await wait(40);
      prevDist = dist;
    }
    cellItemOverlay.set(pk(t.row, t.col), icon);
    itemClearingCells.add(pk(t.row, t.col));
  }

  await wait(ANIM.ITEM_CLEAR + 100);
}

async function animateFlush(pos: Position, targets: Position[]) {
  // Pulse the flush item position
  const cs = cellSize.value;
  const iconSize = Math.round(cs * 0.7);
  const offsetX = pos.col * cs + (cs - iconSize) / 2;
  const offsetY = pos.row * cs + (cs - iconSize) / 2;

  sweepIcon.value = { item: 'flush', x: offsetX, y: offsetY, size: iconSize };
  sweepTransition.value = false;

  // Blink 3 times
  for (let i = 0; i < 3; i++) {
    sweepIcon.value = { ...sweepIcon.value!, size: iconSize };
    await wait(80);
    sweepIcon.value = { ...sweepIcon.value!, size: Math.round(iconSize * 0.6) };
    await wait(80);
  }
  sweepIcon.value = null;

  // Show flush overlay on all targets simultaneously
  for (const t of targets) {
    cellItemOverlay.set(pk(t.row, t.col), 'flush');
  }
  await wait(200);

  // Clear
  for (const t of targets) {
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ANIM.ITEM_CLEAR + 100);
}

// --- Synthesis effect animations ---

async function animateSynthesisEffects(plan: SynthesisAnimPlan) {
  for (const effect of plan.effects) {
    playSE('item_use'); vibrate(30);
    // Remove both items from visual board
    vbRemove(effect.pos1);
    vbRemove(effect.pos2);

    const center = effect.pos1; // synthesis center is the first item position

    switch (effect.effectType) {
      case 'line+line':
        await animateCross(center, effect.targets);
        break;
      case 'v_cut+burst':
        await animateVerticalMulti(center, effect.targets, 'v_cut');
        break;
      case 'h_cut+burst':
        await animateHorizontalMulti(center, effect.targets, 'h_cut');
        break;
      case 'burst+burst':
        await animateBurstLarge(center, effect.targets);
        break;
      case 'flush+flush':
        await animateFlushAll(center, effect.targets);
        break;
      case 'scope+flush':
        await animateFlush(center, effect.targets);
        break;
      default:
        if (effect.effectType.startsWith('flush+')) {
          await animateFlushSynthesis(center, effect.targets, effect.effectType);
        }
        break;
    }

    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }
}

// line+line: cross pattern — vertical top-to-bottom then horizontal left-to-right simultaneously
async function animateCross(pos: Position, targets: Position[]) {
  const colTargets = targets.filter(t => t.col === pos.col).sort((a, b) => a.row - b.row);
  const rowTargets = targets.filter(t => t.row === pos.row && t.col !== pos.col).sort((a, b) => a.col - b.col);

  // Animate both directions in parallel from center
  const maxSteps = Math.max(colTargets.length, rowTargets.length);
  for (let i = 0; i < maxSteps; i++) {
    if (i < colTargets.length) {
      const t = colTargets[i];
      cellItemOverlay.set(pk(t.row, t.col), 'v_cut');
      itemClearingCells.add(pk(t.row, t.col));
    }
    if (i < rowTargets.length) {
      const t = rowTargets[i];
      cellItemOverlay.set(pk(t.row, t.col), 'h_cut');
      itemClearingCells.add(pk(t.row, t.col));
    }
    await wait(ANIM.CELL_SWEEP_INTERVAL);
  }
  await wait(ANIM.ITEM_CLEAR + 100);
}

// v_cut+burst: 3 vertical columns
async function animateVerticalMulti(pos: Position, targets: Position[], icon: string) {
  // Group by column, animate top-to-bottom
  const byCol = new Map<number, Position[]>();
  for (const t of targets) {
    const arr = byCol.get(t.col) ?? [];
    arr.push(t);
    byCol.set(t.col, arr);
  }
  for (const [, col] of byCol) col.sort((a, b) => a.row - b.row);

  const maxRows = Math.max(...[...byCol.values()].map(c => c.length));
  for (let i = 0; i < maxRows; i++) {
    for (const [, col] of byCol) {
      if (i < col.length) {
        const t = col[i];
        cellItemOverlay.set(pk(t.row, t.col), icon);
        itemClearingCells.add(pk(t.row, t.col));
      }
    }
    await wait(ANIM.CELL_SWEEP_INTERVAL);
  }
  await wait(ANIM.ITEM_CLEAR + 100);
}

// h_cut+burst: 3 horizontal rows
async function animateHorizontalMulti(pos: Position, targets: Position[], icon: string) {
  const byRow = new Map<number, Position[]>();
  for (const t of targets) {
    const arr = byRow.get(t.row) ?? [];
    arr.push(t);
    byRow.set(t.row, arr);
  }
  for (const [, row] of byRow) row.sort((a, b) => a.col - b.col);

  const maxCols = Math.max(...[...byRow.values()].map(r => r.length));
  for (let i = 0; i < maxCols; i++) {
    for (const [, row] of byRow) {
      if (i < row.length) {
        const t = row[i];
        cellItemOverlay.set(pk(t.row, t.col), icon);
        itemClearingCells.add(pk(t.row, t.col));
      }
    }
    await wait(ANIM.CELL_SWEEP_INTERVAL);
  }
  await wait(ANIM.ITEM_CLEAR + 100);
}

// burst+burst: large radial expansion
async function animateBurstLarge(pos: Position, targets: Position[]) {
  const sorted = [...targets].sort((a, b) => {
    const da = Math.abs(a.row - pos.row) + Math.abs(a.col - pos.col);
    const db = Math.abs(b.row - pos.row) + Math.abs(b.col - pos.col);
    return da - db;
  });
  let prevDist = -1;
  for (const t of sorted) {
    const dist = Math.abs(t.row - pos.row) + Math.abs(t.col - pos.col);
    if (dist > prevDist) {
      await wait(30);
      prevDist = dist;
    }
    cellItemOverlay.set(pk(t.row, t.col), 'burst');
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ANIM.ITEM_CLEAR + 100);
}

// flush+flush: all tiles blink then clear
async function animateFlushAll(pos: Position, targets: Position[]) {
  // Flash effect
  const cs = cellSize.value;
  const iconSize = Math.round(cs * 0.7);
  const offsetX = pos.col * cs + (cs - iconSize) / 2;
  const offsetY = pos.row * cs + (cs - iconSize) / 2;
  sweepIcon.value = { item: 'flush', x: offsetX, y: offsetY, size: iconSize };
  for (let i = 0; i < 3; i++) {
    sweepIcon.value = { ...sweepIcon.value!, size: iconSize };
    await wait(60);
    sweepIcon.value = { ...sweepIcon.value!, size: Math.round(iconSize * 0.6) };
    await wait(60);
  }
  sweepIcon.value = null;

  // All targets get flush overlay
  for (const t of targets) {
    cellItemOverlay.set(pk(t.row, t.col), 'flush');
  }
  await wait(200);
  for (const t of targets) {
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ANIM.ITEM_CLEAR + 100);
}

// flush+item: color targets clear, then item effects from each
async function animateFlushSynthesis(pos: Position, targets: Position[], effectType: string) {
  const otherItem = effectType.replace('flush+', '') as string;

  // Coffee blink
  const cs = cellSize.value;
  const iconSize = Math.round(cs * 0.7);
  const offsetX = pos.col * cs + (cs - iconSize) / 2;
  const offsetY = pos.row * cs + (cs - iconSize) / 2;
  sweepIcon.value = { item: 'flush', x: offsetX, y: offsetY, size: iconSize };
  for (let i = 0; i < 2; i++) {
    sweepIcon.value = { ...sweepIcon.value!, size: iconSize };
    await wait(60);
    sweepIcon.value = { ...sweepIcon.value!, size: Math.round(iconSize * 0.6) };
    await wait(60);
  }
  sweepIcon.value = null;

  // Show overlays on all targets with the sub-item icon
  for (const t of targets) {
    cellItemOverlay.set(pk(t.row, t.col), otherItem);
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ANIM.ITEM_CLEAR + 200);
}

async function animateSynthesisDropAndChains(plan: SynthesisAnimPlan) {
  const cs = cellSize.value;
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const e of plan.newTileEntries) dropOffsets[pk(e.row, e.col)] = -e.segNulls * cs;
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const dkeys = Object.keys(dropOffsets);
  for (const k of dkeys) dropOffsets[k] = 0;
  await wait(ANIM.DROP);
  dropTransitioning.value = false;
  for (const k of dkeys) delete dropOffsets[k];
  for (const chain of plan.regularChains) await animateChainStep(chain);
}

// --- Drop + chain animations ---

async function animateDropAndChains(plan: ItemAnimPlan) {
  const cs = cellSize.value;

  // Drop after item effects
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const e of plan.newTileEntries) dropOffsets[pk(e.row, e.col)] = -e.segNulls * cs;
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const dkeys = Object.keys(dropOffsets);
  for (const k of dkeys) dropOffsets[k] = 0;
  await wait(ANIM.DROP);
  dropTransitioning.value = false;
  for (const k of dkeys) delete dropOffsets[k];

  // Regular match chains
  for (const chain of plan.regularChains) await animateChainStep(chain);
}

async function animateChainStep(chain: ChainAnimData) {
  const cs = cellSize.value;

  // Checkmarks
  if (chain.chainIndex >= 2) {
    playSE('chain'); vibrate(25);
    shaking.value = true; setTimeout(() => { shaking.value = false; }, 300);
  } else {
    playSE('match'); vibrate(15);
  }
  for (const p of chain.clearedPositions) matchedCells.add(pk(p.row, p.col));
  await wait(ANIM.MATCH_SHOW);

  // Fade out
  playSE('clear');
  for (const p of chain.clearedPositions) clearingCells.add(pk(p.row, p.col));
  await wait(ANIM.CLEAR);
  matchedCells.clear();
  clearingCells.clear();

  // Obstacle damage shake (surviving obstacles adjacent to cleared tiles)
  const damagedKeys: string[] = [];
  if (visualBoard.value) {
    for (const cp of chain.clearedPositions) {
      for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nr = cp.row + dr, nc = cp.col + dc;
        if (nr >= 0 && nr < BOARD_SIZE && nc >= 0 && nc < BOARD_SIZE) {
          const cell = visualBoard.value[nr]?.[nc];
          if (cell?.obstacle && !chain.destroyedObstacles.some(d => d.row === nr && d.col === nc)) {
            const k = pk(nr, nc);
            if (!obstacleDamagedCells.has(k)) {
              obstacleDamagedCells.add(k);
              damagedKeys.push(k);
            }
          }
        }
      }
    }
  }

  // Obstacle destruction
  if (chain.destroyedObstacles.length > 0) {
    for (const p of chain.destroyedObstacles) obstacleClearingCells.add(pk(p.row, p.col));
    await wait(ANIM.CLEAR);
    obstacleClearingCells.clear();
  }

  // Clear damage shake
  if (damagedKeys.length > 0) {
    await wait(100);
    for (const k of damagedKeys) obstacleDamagedCells.delete(k);
  }

  // Drop
  for (const m of chain.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const e of chain.newTileEntries) dropOffsets[pk(e.row, e.col)] = -e.segNulls * cs;
  visualBoard.value = chain.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const keys = Object.keys(dropOffsets);
  for (const k of keys) dropOffsets[k] = 0;
  await wait(ANIM.DROP);
  dropTransitioning.value = false;
  for (const k of keys) delete dropOffsets[k];
}

// --- Style helpers ---
function tileTransform(r: number, c: number) {
  const o = getOff(r, c);
  const drop = dropOffsets[pk(r, c)] ?? 0;
  return `translate(${o.x}px, ${o.y + drop}px)`;
}
function tileTransition(r: number, c: number) {
  const o = getOff(r, c);
  if (o.transition) return `transform ${ANIM.SWAP}ms ease`;
  if (dropTransitioning.value && pk(r, c) in dropOffsets) return `transform ${ANIM.DROP}ms ease-in`;
  return 'none';
}
</script>

<template>
  <div ref="wrapperEl" class="board-wrapper">
    <div
      ref="boardEl"
      :class="['puzzle-board', { shaking }]"
      :style="{ width: boardSize + 'px', height: boardSize + 'px' }"
      @pointerdown="drag.onPointerDown"
      @pointermove="drag.onPointerMove"
      @pointerup="onPointerUpWithDebug"
    >
      <template v-if="activeBoard">
        <div v-for="row in BOARD_SIZE" :key="row" class="board-row">
          <div
            v-for="col in BOARD_SIZE"
            :key="col"
            class="cell"
            :style="{ width: cellSize + 'px', height: cellSize + 'px' }"
          >
            <template v-if="activeBoard[row - 1][col - 1]">
              <div
                class="tile-mover"
                :style="{
                  width: (cellSize - 3) + 'px',
                  height: (cellSize - 3) + 'px',
                  transform: tileTransform(row - 1, col - 1),
                  transition: tileTransition(row - 1, col - 1),
                  zIndex: getOff(row - 1, col - 1).z,
                }"
              >
                <!-- Obstacle tile -->
                <div v-if="activeBoard[row - 1][col - 1]!.obstacle" class="tile obstacle-cell" :class="{ 'is-obstacle-clearing': obstacleClearingCells.has(pk(row - 1, col - 1)), 'is-obstacle-damaged': obstacleDamagedCells.has(pk(row - 1, col - 1)) }">
                  <ObstacleTile
                    :durability="activeBoard[row - 1][col - 1]!.obstacle!.durability"
                    :size="Math.max(0, cellSize - 5)"
                  />
                </div>

                <!-- Item cell -->
                <div v-else-if="activeBoard[row - 1][col - 1]!.item" class="tile item-cell">
                  <ItemIcon :item="activeBoard[row - 1][col - 1]!.item!" :size="Math.round(cellSize * 0.7)" />
                </div>

                <!-- Vegetable tile -->
                <div
                  v-else
                  class="tile veggie-tile"
                  :class="{
                    'is-matched': matchedCells.has(pk(row - 1, col - 1)),
                    'is-clearing': clearingCells.has(pk(row - 1, col - 1)),
                    'is-item-clearing': itemClearingCells.has(pk(row - 1, col - 1)),
                  }"
                >
                  <VegetableIcon
                    :color="activeBoard[row - 1][col - 1]!.color"
                    :size="Math.max(0, cellSize - 5)"
                  />
                  <span
                    v-if="matchedCells.has(pk(row - 1, col - 1)) || clearingCells.has(pk(row - 1, col - 1))"
                    class="check-overlay"
                  >&#x2713;</span>
                </div>
              </div>
            </template>

            <!-- Item effect overlay on cell (burst / flush icon) -->
            <div
              v-if="cellItemOverlay.has(pk(row - 1, col - 1))"
              class="cell-effect-overlay"
            >
              <ItemIcon
                :item="cellItemOverlay.get(pk(row - 1, col - 1))!"
                :size="Math.round(cellSize * 0.5)"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- Sweep icon (v_cut / h_cut / flush blink) -->
      <div
        v-if="sweepIcon"
        class="sweep-icon"
        :style="{
          transform: `translate(${sweepIcon.x}px, ${sweepIcon.y}px)`,
          width: sweepIcon.size + 'px',
          height: sweepIcon.size + 'px',
          transition: sweepTransition ? `transform ${ANIM.CELL_SWEEP_INTERVAL}ms linear` : 'none',
        }"
      >
        <ItemIcon :item="sweepIcon.item" :size="sweepIcon.size" />
      </div>

      <!-- Scope selection overlay -->
      <template v-if="scope.scopeSelecting.value">
        <div
          v-for="row in BOARD_SIZE" :key="'scope-' + row"
        >
          <div
            v-for="col in BOARD_SIZE" :key="'scope-' + row + '-' + col"
            class="scope-select-cell"
            :class="{
              'scope-selected': scope.scopeSelectedCells.value.some(p => p.row === row - 1 && p.col === col - 1),
              'scope-source': scope.scopeSourcePos.value && scope.scopeSourcePos.value.row === row - 1 && scope.scopeSourcePos.value.col === col - 1,
            }"
            :style="{
              position: 'absolute',
              left: ((col - 1) * cellSize) + 'px',
              top: ((row - 1) * cellSize) + 'px',
              width: cellSize + 'px',
              height: cellSize + 'px',
            }"
          />
        </div>
        <div class="scope-status">
          <span>{{ t('board.selectCells', scope.scopeTargetsNeeded.value - scope.scopeSelectedCells.value.length) }}</span>
          <button class="scope-cancel" @click="cancelScopeSelection">{{ t('common.cancel') }}</button>
        </div>
      </template>
    </div>
    <!-- Scope tap hint (outside board overflow) -->
    <div v-if="showScopeTapHint" class="scope-tap-hint">
      {{ scopeTapHintText }}
    </div>
  </div>
</template>

<style scoped>
.board-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.puzzle-board {
  touch-action: none;
  user-select: none;
  background: var(--board-bg);
  border-radius: 8px;
  overflow: hidden;
  margin: 0 auto;
  position: relative;
}
.board-row { display: flex; }
.cell {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.tile-mover {
  will-change: transform;
  position: relative;
}
.tile {
  width: 100%;
  height: 100%;
  position: relative;
}
.veggie-tile {
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-card) 40%, transparent);
}
.obstacle-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.obstacle-cell.is-obstacle-damaged {
  animation: obstacle-shake 0.3s ease-out;
}
.obstacle-cell.is-obstacle-clearing {
  animation: obstacle-destroy 0.35s ease-out forwards;
}
@keyframes obstacle-shake {
  0%, 100% { transform: translate(0, 0); }
  15% { transform: translate(-3px, 0); }
  30% { transform: translate(3px, 0); }
  45% { transform: translate(-2px, 0); }
  60% { transform: translate(2px, 0); }
  75% { transform: translate(-1px, 0); }
}
@keyframes obstacle-destroy {
  0%   { transform: scale(1); opacity: 1; }
  30%  { transform: scale(1.1) rotate(5deg); opacity: 0.8; }
  60%  { transform: scale(0.8) rotate(-3deg); opacity: 0.5; }
  100% { transform: scale(0) rotate(10deg); opacity: 0; }
}

/* Item cell */
.item-cell {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-card) 60%, transparent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
  animation: item-spawn 0.35s ease-out both;
}
@keyframes item-spawn {
  0%   { transform: scale(0) rotate(-30deg); opacity: 0; }
  60%  { transform: scale(1.15) rotate(5deg); opacity: 1; }
  100% { transform: scale(1) rotate(0deg); opacity: 1; }
}

/* Checkmark overlay */
.check-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6em;
  font-weight: 800;
  color: var(--check-color);
  z-index: 2;
  text-shadow: 0 0 4px rgba(255,255,255,0.9), 0 0 1px rgba(255,255,255,1);
  animation: check-in 0.25s ease-out both;
}
@keyframes check-in {
  0%   { transform: scale(0); opacity: 0; }
  60%  { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

/* Match pulse */
.is-matched { animation: match-pulse 0.35s ease both; }
@keyframes match-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.08); }
  100% { transform: scale(1); }
}

/* Clear out (match chains) */
.is-clearing { animation: clear-out 0.25s ease forwards; }
@keyframes clear-out {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.3); }
}

/* Item effect clearing */
.is-item-clearing { animation: item-clear 0.15s ease forwards; }
@keyframes item-clear {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.5); }
}

/* Sweep icon */
.sweep-icon {
  position: absolute;
  top: 0; left: 0;
  pointer-events: none;
  z-index: 20;
  will-change: transform;
  filter: drop-shadow(0 2px 4px rgba(0,0,0,0.3));
}

/* Cell effect overlay (burst/flush icons on target cells) */
.cell-effect-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 15;
  pointer-events: none;
  animation: overlay-pop 0.2s ease-out both;
}
@keyframes overlay-pop {
  0%   { transform: scale(0); opacity: 0; }
  70%  { transform: scale(1.2); opacity: 0.9; }
  100% { transform: scale(1); opacity: 0.8; }
}
.scope-select-cell {
  border: 2px solid rgba(91, 155, 213, 0.5);
  background: rgba(91, 155, 213, 0.1);
  cursor: pointer;
  z-index: 20;
  box-sizing: border-box;
}
.scope-select-cell:hover {
  background: rgba(91, 155, 213, 0.3);
}
.scope-selected {
  background: rgba(91, 155, 213, 0.5) !important;
  border-color: #5b9bd5;
}
.scope-source {
  background: rgba(91, 155, 213, 0.05);
  border-color: rgba(91, 155, 213, 0.2);
  pointer-events: none;
}
.scope-status {
  position: absolute;
  bottom: -32px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--info);
  font-weight: 600;
}
.scope-cancel {
  padding: 2px 10px;
  border: 1px solid var(--info);
  border-radius: 4px;
  background: var(--bg-card);
  color: var(--info);
  font-size: 11px;
  cursor: pointer;
}

/* Scope tap hint */
.scope-tap-hint {
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--info);
  background: var(--bg-card);
  padding: 6px 16px;
  border-radius: 6px;
  box-shadow: var(--shadow-card);
  margin-top: 8px;
  animation: hint-fade 3s ease-out forwards;
}
@keyframes hint-fade {
  0%, 70% { opacity: 1; }
  100% { opacity: 0; }
}

/* Screen shake */
.shaking {
  animation: board-shake 0.3s ease-out;
}
@keyframes board-shake {
  0%, 100% { transform: translate(0, 0); }
  15% { transform: translate(-2px, 1px); }
  30% { transform: translate(2px, -1px); }
  45% { transform: translate(-1px, 2px); }
  60% { transform: translate(1px, -1px); }
  75% { transform: translate(-1px, 0); }
}
</style>
