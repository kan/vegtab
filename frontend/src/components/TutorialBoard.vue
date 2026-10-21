<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { BOARD_SIZE, type Position, type Direction, type Cell } from '@vegtab/engine';
import { useDragHandler, pk, adj } from '@/composables/useDragHandler';
import VegetableIcon from './VegetableIcon.vue';
import ItemIcon from './ItemIcon.vue';
import ObstacleTile from './ObstacleTile.vue';

const props = defineProps<{
  board: (Cell | null)[][] | null;
  highlightCells?: Position[];
  highlightDir?: Direction;
  matchedCells: Set<string>;
  clearingCells: Set<string>;
  focusArea?: { startRow: number; startCol: number; rows: number; cols: number };
  interactive?: boolean;
}>();

const emit = defineEmits<{
  swap: [pos: Position, dir: Direction];
  tap: [pos: Position];
}>();

const wrapperEl = ref<HTMLElement | null>(null);
const boardEl = ref<HTMLElement | null>(null);
const cellSize = ref(0);

function updateCellSize() {
  if (wrapperEl.value) {
    cellSize.value = Math.floor(
      Math.min(wrapperEl.value.clientWidth, wrapperEl.value.clientHeight) / BOARD_SIZE
    );
  }
}

onMounted(() => { updateCellSize(); window.addEventListener('resize', updateCellSize); });
onUnmounted(() => { window.removeEventListener('resize', updateCellSize); });

const boardSize = computed(() => cellSize.value * BOARD_SIZE);

// Drag handler — snap back offsets immediately after swap/tap (no game-state animation here)
const drag = useDragHandler(
  cellSize,
  boardEl,
  (pos, dir) => {
    const nb = adj(pos, dir);
    drag.clearOff(pos.row, pos.col);
    drag.clearOff(nb.row, nb.col);
    emit('swap', pos, dir);
  },
  (pos) => {
    drag.clearOff(pos.row, pos.col);
    emit('tap', pos);
  },
  { isDragSuppressed: () => !props.interactive },
);
const { getOff } = drag;

// Focus area check
function isInFocus(row: number, col: number): boolean {
  if (!props.focusArea) return true;
  const f = props.focusArea;
  return row >= f.startRow && row < f.startRow + f.rows &&
         col >= f.startCol && col < f.startCol + f.cols;
}

// Highlight check
function isHighlighted(row: number, col: number): boolean {
  return !!props.highlightCells?.some(p => p.row === row && p.col === col);
}

// Arrow direction offset
const arrowMap: Record<Direction, { char: string; dx: number; dy: number }> = {
  up: { char: '\u2191', dx: 0, dy: -1 },
  down: { char: '\u2193', dx: 0, dy: 1 },
  left: { char: '\u2190', dx: -1, dy: 0 },
  right: { char: '\u2192', dx: 1, dy: 0 },
};
</script>

<template>
  <div ref="wrapperEl" class="tutorial-board-wrapper">
    <div
      ref="boardEl"
      class="tutorial-board board-frame"
      :style="{ width: boardSize + 'px', height: boardSize + 'px' }"
      @pointerdown="drag.onPointerDown"
      @pointermove="drag.onPointerMove"
      @pointerup="drag.onPointerUp"
    >
      <template v-if="board">
        <div v-for="row in BOARD_SIZE" :key="row" class="board-row">
          <div
            v-for="col in BOARD_SIZE"
            :key="col"
            class="cell"
            :class="{
              'out-of-focus': !isInFocus(row - 1, col - 1),
              'is-highlighted': isHighlighted(row - 1, col - 1),
            }"
            :style="{ width: cellSize + 'px', height: cellSize + 'px' }"
          >
            <template v-if="board[row - 1][col - 1]">
              <div
                class="tile-mover"
                :style="{
                  width: (cellSize - 3) + 'px',
                  height: (cellSize - 3) + 'px',
                  transform: `translate(${getOff(row - 1, col - 1).x}px, ${getOff(row - 1, col - 1).y}px)`,
                  zIndex: getOff(row - 1, col - 1).z,
                }"
              >
                <!-- Obstacle tile -->
                <div v-if="board[row - 1][col - 1]!.obstacle" class="tile obstacle-cell">
                  <ObstacleTile
                    :durability="board[row - 1][col - 1]!.obstacle!.durability"
                    :size="Math.max(0, cellSize - 5)"
                  />
                </div>

                <!-- Item cell -->
                <div v-else-if="board[row - 1][col - 1]!.item" class="tile item-cell">
                  <ItemIcon :item="board[row - 1][col - 1]!.item!" :size="Math.round(cellSize * 0.7)" />
                </div>

                <!-- Vegetable tile -->
                <div
                  v-else
                  class="tile veggie-tile"
                  :class="{
                    'is-matched': matchedCells.has(pk(row - 1, col - 1)),
                    'is-clearing': clearingCells.has(pk(row - 1, col - 1)),
                  }"
                >
                  <VegetableIcon
                    :color="board[row - 1][col - 1]!.color"
                    :size="Math.max(0, cellSize - 5)"
                  />
                </div>
              </div>
            </template>

            <!-- Highlight arrow overlay -->
            <div
              v-if="isHighlighted(row - 1, col - 1) && highlightDir"
              class="highlight-arrow"
              :style="{
                transform: `translate(${arrowMap[highlightDir].dx * cellSize * 0.3}px, ${arrowMap[highlightDir].dy * cellSize * 0.3}px)`,
              }"
            >
              {{ arrowMap[highlightDir].char }}
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tutorial-board-wrapper {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.tutorial-board {
  touch-action: none;
  user-select: none;
  background: var(--board-bg);
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
  transition: opacity 0.3s;
}
.cell.out-of-focus {
  opacity: 0.3;
}
.cell.is-highlighted {
  z-index: 5;
}
.cell.is-highlighted::after {
  content: '';
  position: absolute;
  inset: 2px;
  border-radius: 6px;
  border: 2px solid var(--brand);
  box-shadow: 0 0 8px var(--brand), inset 0 0 4px rgba(46, 125, 50, 0.2);
  animation: highlight-pulse 1.2s ease-in-out infinite;
  pointer-events: none;
  z-index: 10;
}
@keyframes highlight-pulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 8px var(--brand), inset 0 0 4px rgba(46, 125, 50, 0.2); }
  50% { opacity: 0.6; box-shadow: 0 0 16px var(--brand), inset 0 0 8px rgba(46, 125, 50, 0.3); }
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
.item-cell {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-card) 60%, transparent);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.1);
}

/* Match pulse */
.is-matched { animation: match-pulse calc(0.35s / var(--anim-duration-factor, 1)) ease both; }
@keyframes match-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.08); }
  100% { transform: scale(1); }
}

/* Clear out */
.is-clearing { animation: clear-out calc(0.25s / var(--anim-duration-factor, 1)) ease forwards; }
@keyframes clear-out {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.3); }
}

/* Highlight arrow */
.highlight-arrow {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  font-weight: 900;
  color: var(--brand);
  pointer-events: none;
  z-index: 12;
  text-shadow: 0 0 6px rgba(46, 125, 50, 0.6);
  animation: arrow-bounce 1s ease-in-out infinite;
}
@keyframes arrow-bounce {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; transform: translate(0, -3px); }
}
</style>
