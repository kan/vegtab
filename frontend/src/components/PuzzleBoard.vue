<script setup lang="ts">
import { ref, reactive, computed, onMounted, onUnmounted, triggerRef } from 'vue';
import { usePuzzleStore, type ItemAnimPlan, type ChainAnimData, type SynthesisAnimPlan, type MagGlassAnimPlan, type MagSynthesisAnimPlan } from '@/stores/puzzle';
import { BOARD_SIZE, cloneBoard, getSynthesisEffect, type Position, type Direction, type Cell } from '@tomado/engine';
import ItemIcon from './ItemIcon.vue';
import type DebugPanel from './DebugPanel.vue';

const props = defineProps<{
  debugPanel?: InstanceType<typeof DebugPanel> | null;
}>();

const store = usePuzzleStore();
const wrapperEl = ref<HTMLElement | null>(null);
const boardEl = ref<HTMLElement | null>(null);
const cellSize = ref(0);

// --- Magnifying glass selection state ---
const magSelecting = ref(false);
const magSourcePos = ref<Position | null>(null);
const magTargetsNeeded = ref(0);
const magSelectedCells = ref<Position[]>([]);
const magSynthesisInfo = ref<{ pos1: Position; pos2: Position } | null>(null);

const STICKY_COLORS = [
  { band: '#e6c832', bg: '#fdf6d0', fold: '#d4b828' },
  { band: '#5aad5e', bg: '#ddf2dd', fold: '#4a9a4e' },
  { band: '#4088c4', bg: '#d6e8f7', fold: '#3578b0' },
  { band: '#e06b6b', bg: '#fce0e0', fold: '#c85a5a' },
  { band: '#a85e90', bg: '#f0dce8', fold: '#954f80' },
];

const SWAP_DURATION = 150;
const MATCH_SHOW_DURATION = 350;
const CLEAR_DURATION = 250;
const DROP_DURATION = 300;
const CELL_SWEEP_INTERVAL = 40;
const ITEM_CLEAR_DURATION = 150;

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

// --- Item effect animation state ---
const itemClearingCells = reactive(new Set<string>());
const sweepIcon = ref<{ item: string; x: number; y: number; size: number } | null>(null);
const sweepTransition = ref(false);
const cellItemOverlay = reactive(new Map<string, string>());

// --- Drop animation state ---
const dropOffsets = reactive<Record<string, number>>({});
const dropTransitioning = ref(false);

// --- Drag offsets ---
const cellOffsets = reactive<Record<string, { x: number; y: number; transition: boolean; z: number }>>({});

function pk(row: number, col: number) { return `${row},${col}`; }
function getOff(r: number, c: number) { return cellOffsets[pk(r, c)] ?? { x: 0, y: 0, transition: false, z: 0 }; }
function setOff(r: number, c: number, x: number, y: number, tr: boolean, z = 0) { cellOffsets[pk(r, c)] = { x, y, transition: tr, z }; }
function clearOff(r: number, c: number) { delete cellOffsets[pk(r, c)]; }

// --- Pointer handling ---
let ptrX = 0, ptrY = 0;
let ptrPos: Position | null = null;
let handled = false, locked = false;
let dragAxis: 'x' | 'y' | null = null;

function getCellAt(x: number, y: number): Position | null {
  if (!boardEl.value || !cellSize.value) return null;
  const r = boardEl.value.getBoundingClientRect();
  const col = Math.floor((x - r.left) / cellSize.value);
  const row = Math.floor((y - r.top) / cellSize.value);
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) return null;
  return { row, col };
}

function adj(p: Position, d: Direction): Position {
  switch (d) {
    case 'up': return { row: p.row - 1, col: p.col };
    case 'down': return { row: p.row + 1, col: p.col };
    case 'left': return { row: p.row, col: p.col - 1 };
    case 'right': return { row: p.row, col: p.col + 1 };
  }
}

function onPointerDown(e: PointerEvent) {
  if (locked) return;
  const pos = getCellAt(e.clientX, e.clientY);
  if (!pos) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  ptrX = e.clientX; ptrY = e.clientY;
  ptrPos = pos; handled = false; dragAxis = null;
  setOff(pos.row, pos.col, 0, 0, false, 10);
}

function onPointerMove(e: PointerEvent) {
  if (!ptrPos || handled || locked) return;
  const dx = e.clientX - ptrX, dy = e.clientY - ptrY;
  const cs = cellSize.value;
  if (!dragAxis) {
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) dragAxis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
    else return;
  }
  let cx = 0, cy = 0;
  if (dragAxis === 'x') cx = Math.max(-cs, Math.min(cs, dx));
  else cy = Math.max(-cs, Math.min(cs, dy));
  setOff(ptrPos.row, ptrPos.col, cx, cy, false, 10);
  const dir = dragDir(cx, cy);
  if (dir) {
    const nb = adj(ptrPos, dir);
    if (nb.row >= 0 && nb.row < BOARD_SIZE && nb.col >= 0 && nb.col < BOARD_SIZE)
      setOff(nb.row, nb.col, -cx, -cy, false, 0);
  }
  if (Math.abs(cx) > cs * 0.4 || Math.abs(cy) > cs * 0.4) {
    handled = true;
    commitSwap(ptrPos, dir!);
    ptrPos = null;
  }
}

function onPointerUp(e: PointerEvent) {
  if (locked) return;
  if (ptrPos && !handled) {
    if (Math.abs(e.clientX - ptrX) < 5 && Math.abs(e.clientY - ptrY) < 5) {
      // Debug panel intercept
      if (props.debugPanel?.isPlacing && props.debugPanel.handleCellTap(ptrPos.row, ptrPos.col)) {
        clearOff(ptrPos.row, ptrPos.col);
        ptrPos = null; handled = false; dragAxis = null;
        return;
      }
      handleTap(ptrPos);
    }
    snapBack(ptrPos);
  }
  ptrPos = null; handled = false; dragAxis = null;
}

function snapBack(pos: Position) {
  setOff(pos.row, pos.col, 0, 0, true, 0);
  for (const d of ['up', 'down', 'left', 'right'] as Direction[]) {
    const n = adj(pos, d);
    if (n.row >= 0 && n.row < BOARD_SIZE && n.col >= 0 && n.col < BOARD_SIZE) setOff(n.row, n.col, 0, 0, true, 0);
  }
  setTimeout(() => {
    clearOff(pos.row, pos.col);
    for (const d of ['up', 'down', 'left', 'right'] as Direction[]) { const n = adj(pos, d); clearOff(n.row, n.col); }
  }, SWAP_DURATION);
}

function dragDir(dx: number, dy: number): Direction | null {
  if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return null;
  return Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
}

// --- Utilities ---
function wait(ms: number) { return new Promise<void>(r => setTimeout(r, ms)); }
function nextFrame() { return new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(r))); }

// --- Tap ---
async function handleTap(pos: Position) {
  // Magnifying glass cell selection mode
  if (magSelecting.value) {
    handleMagSelection(pos);
    return;
  }

  // Check if tapping a magnifying glass → enter selection mode
  const cell = activeBoard.value?.[pos.row]?.[pos.col];
  if (cell?.item === 'magnifying_glass') {
    magSelecting.value = true;
    magSourcePos.value = pos;
    magTargetsNeeded.value = 1;
    magSelectedCells.value = [];
    magSynthesisInfo.value = null;
    clearOff(pos.row, pos.col);
    return;
  }

  const plan = store.computeItemTapPlan(pos);
  if (!plan) { store.tap(pos); return; }

  locked = true;
  clearOff(pos.row, pos.col);
  visualBoard.value = plan.boardBeforeActivation;

  await animateItemEffects(plan);
  await animateDropAndChains(plan);

  store.applyState(plan.finalState);
  visualBoard.value = null;
  locked = false;
}

async function handleMagSelection(pos: Position) {
  // Don't allow selecting the magnifying glass itself
  if (magSourcePos.value && pos.row === magSourcePos.value.row && pos.col === magSourcePos.value.col) return;
  // Don't allow duplicate selections
  if (magSelectedCells.value.some(p => p.row === pos.row && p.col === pos.col)) return;

  magSelectedCells.value.push(pos);

  if (magSelectedCells.value.length >= magTargetsNeeded.value) {
    const cells = [...magSelectedCells.value];
    const source = magSourcePos.value!;
    const synthInfo = magSynthesisInfo.value;

    // Reset selection state
    magSelecting.value = false;
    magSourcePos.value = null;
    magSelectedCells.value = [];
    magSynthesisInfo.value = null;

    if (synthInfo) {
      await animateMagSynthesis(synthInfo.pos1, synthInfo.pos2, cells);
    } else {
      await animateMagGlass(source, cells);
    }
  }
}

function cancelMagSelection() {
  magSelecting.value = false;
  magSourcePos.value = null;
  magSelectedCells.value = [];
  magSynthesisInfo.value = null;
  visualBoard.value = null;
}

async function animateMagGlass(magPos: Position, targetCells: Position[]) {
  // If visualBoard is set (e.g. from a swap), apply the swapped board to the store
  // so computeMagGlassPlan sees the correct board. Save original state for undo.
  let originalState: typeof store.gameState = null;
  if (visualBoard.value !== null) {
    originalState = store.gameState ? { ...store.gameState } : null;
    const swappedState = { ...store.gameState!, board: cloneBoard(visualBoard.value!) };
    store.applyState(swappedState);
    visualBoard.value = null;
  }

  const plan = store.computeMagGlassPlan(magPos, targetCells);
  if (!plan) {
    // Fallback: apply instantly
    if (originalState) store.applyState(originalState);
    store.activateMagnifyingGlass(magPos, targetCells);
    return;
  }

  // Patch previousState to point to the original (pre-swap) state for correct undo
  if (originalState) {
    plan.finalState.previousState = originalState;
  }

  locked = true;

  // Build a board with the magnifying glass removed but targets still present
  const boardWithoutMag = cloneBoard(store.board!);
  boardWithoutMag[magPos.row][magPos.col] = null;
  visualBoard.value = boardWithoutMag;

  // Show magnifying glass overlay on target cells (only non-item targets)
  const nonItemTargets = targetCells.filter(t => {
    const cell = boardWithoutMag[t.row]?.[t.col];
    return cell && !cell.item;
  });
  await animateRadial(magPos, nonItemTargets, 'magnifying_glass');
  for (const t of nonItemTargets) vbRemove(t);
  itemClearingCells.clear();
  cellItemOverlay.clear();

  // Switch to board after clear
  visualBoard.value = plan.boardAfterClear;

  // Animate item detonations if any
  for (const effect of plan.itemEffects) {
    vbRemove(effect.itemPos);
    switch (effect.itemType) {
      case 'magnifying_glass': await animateRadial(effect.itemPos, effect.targets, 'magnifying_glass'); break;
      case 'scissors': await animateScissors(effect.itemPos, effect.targets); break;
      case 'cutter': await animateCutter(effect.itemPos, effect.targets); break;
      case 'clip': await animateClip(effect.itemPos, effect.targets); break;
      case 'coffee': await animateCoffee(effect.itemPos, effect.targets); break;
    }
    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  // Drop animation
  const cs = cellSize.value;
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const [col, count] of plan.newTilesPerCol) {
    for (let row = 0; row < count; row++) dropOffsets[pk(row, col)] = -count * cs;
  }
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const keys = Object.keys(dropOffsets);
  for (const k of keys) dropOffsets[k] = 0;
  await wait(DROP_DURATION);
  dropTransitioning.value = false;
  for (const k of keys) delete dropOffsets[k];

  // Regular chains
  for (const chain of plan.regularChains) await animateChainStep(chain);

  store.applyState(plan.finalState);
  visualBoard.value = null;
  locked = false;
}

async function animateMagSynthesis(pos1: Position, pos2: Position, targetCells: Position[]) {
  const plan = store.computeMagSynthesisPlan(pos1, pos2, targetCells);
  if (!plan) {
    // Fallback: apply instantly
    store.applyMagnifyingSynthesis(pos1, pos2, targetCells);
    return;
  }

  locked = true;

  // Remove both items from visual board
  const boardWithoutItems = cloneBoard(store.board!);
  boardWithoutItems[pos1.row][pos1.col] = null;
  boardWithoutItems[pos2.row][pos2.col] = null;
  visualBoard.value = boardWithoutItems;

  if (plan.synthEffect === 'mag+mag') {
    // mag+mag: show magnifying glass overlay on 3 selected cells, then clear
    await animateRadial(pos1, plan.effectTargets, 'magnifying_glass');
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  } else if (plan.synthEffect === 'mag+scissors') {
    await animateScissors(targetCells[0], plan.effectTargets);
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  } else if (plan.synthEffect === 'mag+cutter') {
    await animateCutter(targetCells[0], plan.effectTargets);
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  } else if (plan.synthEffect === 'mag+clip') {
    await animateClip(targetCells[0], plan.effectTargets);
    for (const t of plan.effectTargets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  visualBoard.value = plan.boardAfterClear;

  // Animate item detonations if any
  for (const effect of plan.itemEffects) {
    vbRemove(effect.itemPos);
    switch (effect.itemType) {
      case 'magnifying_glass': await animateRadial(effect.itemPos, effect.targets, 'magnifying_glass'); break;
      case 'scissors': await animateScissors(effect.itemPos, effect.targets); break;
      case 'cutter': await animateCutter(effect.itemPos, effect.targets); break;
      case 'clip': await animateClip(effect.itemPos, effect.targets); break;
      case 'coffee': await animateCoffee(effect.itemPos, effect.targets); break;
    }
    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }

  // Drop animation
  const cs = cellSize.value;
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const [col, count] of plan.newTilesPerCol) {
    for (let row = 0; row < count; row++) dropOffsets[pk(row, col)] = -count * cs;
  }
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const keys = Object.keys(dropOffsets);
  for (const k of keys) dropOffsets[k] = 0;
  await wait(DROP_DURATION);
  dropTransitioning.value = false;
  for (const k of keys) delete dropOffsets[k];

  // Regular chains
  for (const chain of plan.regularChains) await animateChainStep(chain);

  store.applyState(plan.finalState);
  visualBoard.value = null;
  locked = false;
}

// --- Swap ---
async function commitSwap(pos: Position, dir: Direction) {
  locked = true;
  const cs = cellSize.value;
  const nb = adj(pos, dir);
  const fullX = (nb.col - pos.col) * cs, fullY = (nb.row - pos.row) * cs;

  // Slide
  setOff(pos.row, pos.col, fullX, fullY, true, 10);
  setOff(nb.row, nb.col, -fullX, -fullY, true, 0);
  await wait(SWAP_DURATION);

  // Try normal swap
  const swapPlan = store.computeSwapPlan(pos, dir);
  if (swapPlan) {
    clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
    visualBoard.value = swapPlan.boardAfterSwap;
    for (const chain of swapPlan.chains) await animateChainStep(chain);
    store.applyState(swapPlan.finalState);
    visualBoard.value = null;
    locked = false;
    return;
  }

  // Magnifying glass swap with regular tile → enter selection mode
  {
    const cell1 = activeBoard.value?.[pos.row]?.[pos.col];
    const cell2 = activeBoard.value?.[nb.row]?.[nb.col];
    if (cell1 && cell2) {
      const magCell = cell1.item === 'magnifying_glass' ? cell1 : cell2.item === 'magnifying_glass' ? cell2 : null;
      if (magCell && !(cell1.item && cell2.item)) {
        // One is magnifying glass, the other is a regular tile (not both items)
        // After slide animation, mag moved to the neighbor's position
        const magPos = cell1.item === 'magnifying_glass' ? nb : pos;
        clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
        // Show the swapped board visually
        const swapped = cloneBoard(store.board!);
        swapped[pos.row][pos.col] = cell2;
        swapped[nb.row][nb.col] = cell1;
        visualBoard.value = swapped;
        magSelecting.value = true;
        magSourcePos.value = magPos;
        magTargetsNeeded.value = 1;
        magSelectedCells.value = [];
        magSynthesisInfo.value = null;
        locked = false;
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
    locked = false;
    return;
  }

  // Magnifying glass synthesis (needs user selection)
  {
    const cell1 = activeBoard.value?.[pos.row]?.[pos.col];
    const cell2 = activeBoard.value?.[nb.row]?.[nb.col];
    if (cell1?.item && cell2?.item) {
      const hasMag = cell1.item === 'magnifying_glass' || cell2.item === 'magnifying_glass';
      if (hasMag) {
        const synth = getSynthesisEffect(cell1.item, cell2.item);
        if (synth && ['mag+mag', 'mag+scissors', 'mag+cutter', 'mag+clip'].includes(synth.effect)) {
          clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
          magSelecting.value = true;
          magSourcePos.value = pos;
          magTargetsNeeded.value = synth.effect === 'mag+mag' ? 3 : 1;
          magSelectedCells.value = [];
          magSynthesisInfo.value = { pos1: pos, pos2: nb };
          locked = false;
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
    locked = false;
    return;
  }

  // Invalid → bounce back
  setOff(pos.row, pos.col, 0, 0, true, 0);
  setOff(nb.row, nb.col, 0, 0, true, 0);
  await wait(SWAP_DURATION);
  clearOff(pos.row, pos.col); clearOff(nb.row, nb.col);
  locked = false;
}

// --- Item effect animations ---

async function animateItemEffects(plan: ItemAnimPlan) {
  for (const effect of plan.effects) {
    // Remove item from visual board
    vbRemove(effect.itemPos);

    switch (effect.itemType) {
      case 'magnifying_glass': await animateRadial(effect.itemPos, effect.targets, 'magnifying_glass'); break;
      case 'scissors': await animateScissors(effect.itemPos, effect.targets); break;
      case 'cutter': await animateCutter(effect.itemPos, effect.targets); break;
      case 'clip': await animateClip(effect.itemPos, effect.targets); break;
      case 'coffee': await animateCoffee(effect.itemPos, effect.targets); break;
    }

    // Remove targets from visual board
    for (const t of effect.targets) vbRemove(t);
    itemClearingCells.clear();
    cellItemOverlay.clear();
  }
}

async function animateScissors(pos: Position, targets: Position[]) {
  // Top to bottom: overlay scissors icon on each target cell sequentially
  const col = pos.col;
  const sorted = [...targets].filter(t => t.col === col).sort((a, b) => a.row - b.row);

  for (const t of sorted) {
    cellItemOverlay.set(pk(t.row, t.col), 'scissors');
    itemClearingCells.add(pk(t.row, t.col));
    await wait(CELL_SWEEP_INTERVAL);
  }

  await wait(ITEM_CLEAR_DURATION + 100);
}

async function animateCutter(pos: Position, targets: Position[]) {
  // Left to right: overlay cutter icon on each target cell sequentially
  const row = pos.row;
  const sorted = [...targets].filter(t => t.row === row).sort((a, b) => a.col - b.col);

  for (const t of sorted) {
    cellItemOverlay.set(pk(t.row, t.col), 'cutter');
    itemClearingCells.add(pk(t.row, t.col));
    await wait(CELL_SWEEP_INTERVAL);
  }

  await wait(ITEM_CLEAR_DURATION + 100);
}

async function animateRadial(pos: Position, targets: Position[], icon: string) {
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

  await wait(ITEM_CLEAR_DURATION + 100);
}

async function animateClip(pos: Position, targets: Position[]) {
  await animateRadial(pos, targets, 'clip');
}

async function animateCoffee(pos: Position, targets: Position[]) {
  // Pulse the coffee cup position
  const cs = cellSize.value;
  const iconSize = Math.round(cs * 0.7);
  const offsetX = pos.col * cs + (cs - iconSize) / 2;
  const offsetY = pos.row * cs + (cs - iconSize) / 2;

  sweepIcon.value = { item: 'coffee', x: offsetX, y: offsetY, size: iconSize };
  sweepTransition.value = false;

  // Blink 3 times
  for (let i = 0; i < 3; i++) {
    sweepIcon.value = { ...sweepIcon.value!, size: iconSize };
    await wait(80);
    sweepIcon.value = { ...sweepIcon.value!, size: Math.round(iconSize * 0.6) };
    await wait(80);
  }
  sweepIcon.value = null;

  // Show coffee overlay on all targets simultaneously
  for (const t of targets) {
    cellItemOverlay.set(pk(t.row, t.col), 'coffee');
  }
  await wait(200);

  // Clear
  for (const t of targets) {
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ITEM_CLEAR_DURATION + 100);
}

// --- Synthesis effect animations ---

async function animateSynthesisEffects(plan: SynthesisAnimPlan) {
  for (const effect of plan.effects) {
    // Remove both items from visual board
    vbRemove(effect.pos1);
    vbRemove(effect.pos2);

    const center = effect.pos1; // synthesis center is the first item position

    switch (effect.effectType) {
      case 'line+line':
        await animateCross(center, effect.targets);
        break;
      case 'scissors+clip':
        await animateVerticalMulti(center, effect.targets, 'scissors');
        break;
      case 'cutter+clip':
        await animateHorizontalMulti(center, effect.targets, 'cutter');
        break;
      case 'clip+clip':
        await animateClipLarge(center, effect.targets);
        break;
      case 'coffee+coffee':
        await animateCoffeeAll(center, effect.targets);
        break;
      case 'mag+coffee':
        await animateCoffee(center, effect.targets);
        break;
      default:
        if (effect.effectType.startsWith('coffee+')) {
          await animateCoffeeSynthesis(center, effect.targets, effect.effectType);
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
      cellItemOverlay.set(pk(t.row, t.col), 'scissors');
      itemClearingCells.add(pk(t.row, t.col));
    }
    if (i < rowTargets.length) {
      const t = rowTargets[i];
      cellItemOverlay.set(pk(t.row, t.col), 'cutter');
      itemClearingCells.add(pk(t.row, t.col));
    }
    await wait(CELL_SWEEP_INTERVAL);
  }
  await wait(ITEM_CLEAR_DURATION + 100);
}

// scissors+clip: 3 vertical columns
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
    await wait(CELL_SWEEP_INTERVAL);
  }
  await wait(ITEM_CLEAR_DURATION + 100);
}

// cutter+clip: 3 horizontal rows
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
    await wait(CELL_SWEEP_INTERVAL);
  }
  await wait(ITEM_CLEAR_DURATION + 100);
}

// clip+clip: large radial expansion
async function animateClipLarge(pos: Position, targets: Position[]) {
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
    cellItemOverlay.set(pk(t.row, t.col), 'clip');
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ITEM_CLEAR_DURATION + 100);
}

// coffee+coffee: all tiles blink then clear
async function animateCoffeeAll(pos: Position, targets: Position[]) {
  // Flash effect
  const cs = cellSize.value;
  const iconSize = Math.round(cs * 0.7);
  const offsetX = pos.col * cs + (cs - iconSize) / 2;
  const offsetY = pos.row * cs + (cs - iconSize) / 2;
  sweepIcon.value = { item: 'coffee', x: offsetX, y: offsetY, size: iconSize };
  for (let i = 0; i < 3; i++) {
    sweepIcon.value = { ...sweepIcon.value!, size: iconSize };
    await wait(60);
    sweepIcon.value = { ...sweepIcon.value!, size: Math.round(iconSize * 0.6) };
    await wait(60);
  }
  sweepIcon.value = null;

  // All targets get coffee overlay
  for (const t of targets) {
    cellItemOverlay.set(pk(t.row, t.col), 'coffee');
  }
  await wait(200);
  for (const t of targets) {
    itemClearingCells.add(pk(t.row, t.col));
  }
  await wait(ITEM_CLEAR_DURATION + 100);
}

// coffee+item: color targets clear, then item effects from each
async function animateCoffeeSynthesis(pos: Position, targets: Position[], effectType: string) {
  const otherItem = effectType.replace('coffee+', '') as string;

  // Coffee blink
  const cs = cellSize.value;
  const iconSize = Math.round(cs * 0.7);
  const offsetX = pos.col * cs + (cs - iconSize) / 2;
  const offsetY = pos.row * cs + (cs - iconSize) / 2;
  sweepIcon.value = { item: 'coffee', x: offsetX, y: offsetY, size: iconSize };
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
  await wait(ITEM_CLEAR_DURATION + 200);
}

async function animateSynthesisDropAndChains(plan: SynthesisAnimPlan) {
  const cs = cellSize.value;
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const [col, count] of plan.newTilesPerCol) {
    for (let row = 0; row < count; row++) dropOffsets[pk(row, col)] = -count * cs;
  }
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const dkeys = Object.keys(dropOffsets);
  for (const k of dkeys) dropOffsets[k] = 0;
  await wait(DROP_DURATION);
  dropTransitioning.value = false;
  for (const k of dkeys) delete dropOffsets[k];
  for (const chain of plan.regularChains) await animateChainStep(chain);
}

// --- Drop + chain animations ---

async function animateDropAndChains(plan: ItemAnimPlan) {
  const cs = cellSize.value;

  // Drop after item effects
  for (const m of plan.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const [col, count] of plan.newTilesPerCol) {
    for (let row = 0; row < count; row++) dropOffsets[pk(row, col)] = -count * cs;
  }
  visualBoard.value = plan.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const dkeys = Object.keys(dropOffsets);
  for (const k of dkeys) dropOffsets[k] = 0;
  await wait(DROP_DURATION);
  dropTransitioning.value = false;
  for (const k of dkeys) delete dropOffsets[k];

  // Regular match chains
  for (const chain of plan.regularChains) await animateChainStep(chain);
}

async function animateChainStep(chain: ChainAnimData) {
  const cs = cellSize.value;

  // Checkmarks
  for (const p of chain.clearedPositions) matchedCells.add(pk(p.row, p.col));
  await wait(MATCH_SHOW_DURATION);

  // Fade out
  for (const p of chain.clearedPositions) clearingCells.add(pk(p.row, p.col));
  await wait(CLEAR_DURATION);
  matchedCells.clear();
  clearingCells.clear();

  // Drop
  for (const m of chain.dropMoves) dropOffsets[pk(m.toRow, m.col)] = (m.fromRow - m.toRow) * cs;
  for (const [col, count] of chain.newTilesPerCol) {
    for (let row = 0; row < count; row++) dropOffsets[pk(row, col)] = -count * cs;
  }
  visualBoard.value = chain.boardAfterDrop;
  await nextFrame();
  dropTransitioning.value = true;
  const keys = Object.keys(dropOffsets);
  for (const k of keys) dropOffsets[k] = 0;
  await wait(DROP_DURATION);
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
  if (o.transition) return `transform ${SWAP_DURATION}ms ease`;
  if (dropTransitioning.value && pk(r, c) in dropOffsets) return `transform ${DROP_DURATION}ms ease-in`;
  return 'none';
}
</script>

<template>
  <div ref="wrapperEl" class="board-wrapper">
    <div
      ref="boardEl"
      class="puzzle-board"
      :style="{ width: boardSize + 'px', height: boardSize + 'px' }"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
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
                <!-- Item cell -->
                <div v-if="activeBoard[row - 1][col - 1]!.item" class="tile item-cell">
                  <ItemIcon :item="activeBoard[row - 1][col - 1]!.item!" :size="Math.round(cellSize * 0.7)" />
                </div>

                <!-- Sticky note cell -->
                <div
                  v-else
                  class="tile sticky-note"
                  :class="{
                    'is-matched': matchedCells.has(pk(row - 1, col - 1)),
                    'is-clearing': clearingCells.has(pk(row - 1, col - 1)),
                    'is-item-clearing': itemClearingCells.has(pk(row - 1, col - 1)),
                  }"
                  :style="{
                    '--band-color': STICKY_COLORS[activeBoard[row - 1][col - 1]!.color].band,
                    '--bg-color': STICKY_COLORS[activeBoard[row - 1][col - 1]!.color].bg,
                    '--fold-color': STICKY_COLORS[activeBoard[row - 1][col - 1]!.color].fold,
                    '--fold-size': Math.round(cellSize * 0.18) + 'px',
                    '--check-color': STICKY_COLORS[activeBoard[row - 1][col - 1]!.color].band,
                  }"
                >
                  <div class="sticky-band" />
                  <span
                    v-if="matchedCells.has(pk(row - 1, col - 1)) || clearingCells.has(pk(row - 1, col - 1))"
                    class="check-overlay"
                  >&#x2713;</span>
                </div>
              </div>
            </template>

            <!-- Item effect overlay on cell (clip / coffee icon) -->
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

      <!-- Sweep icon (scissors / cutter / coffee blink) -->
      <div
        v-if="sweepIcon"
        class="sweep-icon"
        :style="{
          transform: `translate(${sweepIcon.x}px, ${sweepIcon.y}px)`,
          width: sweepIcon.size + 'px',
          height: sweepIcon.size + 'px',
          transition: sweepTransition ? `transform ${CELL_SWEEP_INTERVAL}ms linear` : 'none',
        }"
      >
        <ItemIcon :item="sweepIcon.item" :size="sweepIcon.size" />
      </div>

      <!-- Magnifying glass selection overlay -->
      <template v-if="magSelecting">
        <div
          v-for="row in BOARD_SIZE" :key="'mag-' + row"
        >
          <div
            v-for="col in BOARD_SIZE" :key="'mag-' + row + '-' + col"
            class="mag-select-cell"
            :class="{
              'mag-selected': magSelectedCells.some(p => p.row === row - 1 && p.col === col - 1),
              'mag-source': magSourcePos && magSourcePos.row === row - 1 && magSourcePos.col === col - 1,
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
        <div class="mag-status">
          <span>Select {{ magTargetsNeeded - magSelectedCells.length }} cell{{ magTargetsNeeded - magSelectedCells.length !== 1 ? 's' : '' }}</span>
          <button class="mag-cancel" @click="cancelMagSelection">Cancel</button>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.board-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.puzzle-board {
  touch-action: none;
  user-select: none;
  background: #d4c9b8;
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
.sticky-note {
  background: var(--bg-color);
  border-radius: 3px 3px 0 3px;
  box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.13);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  clip-path: polygon(0% 0%, 100% 0%, 100% calc(100% - var(--fold-size)), calc(100% - var(--fold-size)) 100%, 0% 100%);
}
.sticky-note::after {
  content: '';
  position: absolute;
  right: 0; bottom: 0;
  width: var(--fold-size);
  height: var(--fold-size);
  background: linear-gradient(135deg, var(--fold-color) 50%, rgba(0,0,0,0.08) 50%);
  border-radius: 0 0 0 2px;
}
.sticky-band {
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 28%;
  background: var(--band-color);
  opacity: 0.85;
}

/* Item cell */
.item-cell {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.6);
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

/* Cell effect overlay (clip/coffee icons on target cells) */
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
.mag-select-cell {
  border: 2px solid rgba(91, 155, 213, 0.5);
  background: rgba(91, 155, 213, 0.1);
  cursor: pointer;
  z-index: 20;
  box-sizing: border-box;
}
.mag-select-cell:hover {
  background: rgba(91, 155, 213, 0.3);
}
.mag-selected {
  background: rgba(91, 155, 213, 0.5) !important;
  border-color: #5b9bd5;
}
.mag-source {
  background: rgba(91, 155, 213, 0.05);
  border-color: rgba(91, 155, 213, 0.2);
  pointer-events: none;
}
.mag-status {
  position: absolute;
  bottom: -32px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: #5b9bd5;
  font-weight: 600;
}
.mag-cancel {
  padding: 2px 10px;
  border: 1px solid #5b9bd5;
  border-radius: 4px;
  background: #fff;
  color: #5b9bd5;
  font-size: 11px;
  cursor: pointer;
}
</style>
