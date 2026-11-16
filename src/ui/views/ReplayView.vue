<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/client';
import { useReplayPlayer } from '@/composables/useReplayPlayer';
import VegetableIcon from '@/components/VegetableIcon.vue';
import ItemIcon from '@/components/ItemIcon.vue';
import ObstacleTile from '@/components/ObstacleTile.vue';
import type { ReplayAction } from '@/stores/puzzle';
import { ctrlPrevTrackIcon, ctrlRewindIcon, ctrlPauseIcon, ctrlPlayIcon, ctrlForwardIcon, ctrlNextTrackIcon } from '@/assets/icons';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref('');
const replaySeed = ref(0);
const replayPlayerName = ref('');

const player = useReplayPlayer();

const CELL_SIZE = 40;

onMounted(async () => {
  const scoreId = route.params.scoreId as string;
  if (!scoreId) {
    error.value = 'Missing score ID';
    loading.value = false;
    return;
  }

  try {
    const data = await api<{
      replayLog: ReplayAction[];
      seed: number;
      finalScore?: number;
      displayName?: string;
    }>(`/api/scores/${encodeURIComponent(scoreId)}/replay`);

    replaySeed.value = data.seed;
    replayPlayerName.value = data.displayName ?? '';
    player.load(data.seed, data.replayLog, { finalScore: data.finalScore });
    loading.value = false;
  } catch {
    error.value = t('replay.loadError');
    loading.value = false;
  }
});

/** Convert internal (row, col) to chess-style notation: col→a-h, row→8-1 */
function toChessCoord(row: number, col: number): string {
  return String.fromCharCode(97 + col) + (8 - row);
}

function actionLabel(action: ReplayAction, index: number): string {
  const num = index + 1;
  const chain = player.chainCounts.value[index] ?? 0;
  const chainSuffix = chain >= 2 ? ` 🔗${chain}` : '';
  if (action.type === 'swap') {
    const dirLabel = t(`replay.dir_${action.dir}`);
    return `${num}. ${toChessCoord(action.pos.row, action.pos.col)} ${dirLabel}${chainSuffix}`;
  }
  if (action.type === 'tap') {
    return `${num}. ${toChessCoord(action.pos.row, action.pos.col)} ${t('replay.tap')}${chainSuffix}`;
  }
  if (action.type === 'scope') {
    return `${num}. ${toChessCoord(action.pos.row, action.pos.col)} ${t('replay.scope')}${chainSuffix}`;
  }
  if (action.type === 'scope_synthesis') {
    return `${num}. ${toChessCoord(action.pos1.row, action.pos1.col)}+${toChessCoord(action.pos2.row, action.pos2.col)} ${t('replay.scope')}${chainSuffix}`;
  }
  if (action.type === 'scope_swap') {
    const dirLabel = t(`replay.dir_${action.dir}`);
    return `${num}. ${toChessCoord(action.pos.row, action.pos.col)} ${dirLabel} + ${t('replay.scope')}${chainSuffix}`;
  }
  return `${num}. ???`;
}

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

// Coordinate highlight: hover/click on rank or file label
const highlightRow = ref<number | null>(null);
const highlightCol = ref<number | null>(null);

function onRankHover(rankIdx: number) { highlightRow.value = rankIdx; }
function onFileHover(fileIdx: number) { highlightCol.value = fileIdx; }
function onRankClick(rankIdx: number) { highlightRow.value = highlightRow.value === rankIdx ? null : rankIdx; }
function onFileClick(fileIdx: number) { highlightCol.value = highlightCol.value === fileIdx ? null : fileIdx; }
function clearHighlight() { highlightRow.value = null; highlightCol.value = null; }

const speedOptions = [
  { label: '0.5x', ms: 2000 },
  { label: '1x', ms: 1000 },
  { label: '2x', ms: 500 },
  { label: '4x', ms: 250 },
];

function getCellClass(row: number, col: number): string {
  const key = `${row},${col}`;
  if (player.clearingCells.has(key)) return 'cell-clearing';
  if (player.matchedCells.has(key)) return 'cell-matched';
  const action = player.nextAction.value;
  if (action) {
    if (action.type === 'scope_synthesis') {
      if ((action.pos1.row === row && action.pos1.col === col)
        || (action.pos2.row === row && action.pos2.col === col)) return 'cell-highlight';
    } else if ('pos' in action) {
      if (action.pos.row === row && action.pos.col === col) return 'cell-highlight';
    }
  }
  if (highlightRow.value === row || highlightCol.value === col) return 'cell-coord-highlight';
  return '';
}
</script>

<template>
  <div class="replay-view">
    <!-- Loading -->
    <div v-if="loading" class="replay-center">
      <p>{{ t('replay.loading') }}</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="replay-center">
      <p>{{ error }}</p>
      <button class="btn btn-primary" @click="router.push('/')">{{ t('common.home') }}</button>
    </div>

    <!-- Replay -->
    <template v-else>
      <header class="replay-header">
        <button class="btn btn-sm btn-back" @click="router.back()">&larr;</button>
        <div class="replay-info">
          <span class="replay-title">{{ t('replay.title') }}</span>
          <span class="replay-meta">
            <template v-if="replayPlayerName">{{ replayPlayerName }} &middot; </template>
            {{ t('common.seed', { seed: replaySeed }) }}
          </span>
        </div>
      </header>

      <!-- Board with coordinate labels -->
      <div class="replay-board-wrapper">
        <div class="board-with-labels">
          <!-- Rank labels (left side: 8,7,6,...,1) -->
          <div class="rank-labels" :style="{ height: CELL_SIZE * 8 + 'px' }">
            <div
              v-for="(rank, idx) in RANKS" :key="rank"
              :class="['coord-label', { 'coord-active': highlightRow === idx }]"
              :style="{ height: CELL_SIZE + 'px' }"
              @pointerenter="onRankHover(idx)"
              @pointerleave="clearHighlight"
              @click="onRankClick(idx)"
            >{{ rank }}</div>
          </div>
          <div class="board-and-files">
            <div class="replay-board board-frame" :style="{ width: CELL_SIZE * 8 + 'px', height: CELL_SIZE * 8 + 'px' }">
              <template v-if="player.currentBoard.value">
                <div
                  v-for="(row, r) in player.currentBoard.value"
                  :key="r"
                  class="replay-row"
                >
                  <div
                    v-for="(cell, c) in row"
                    :key="c"
                    :class="['replay-cell', getCellClass(r, c)]"
                    :style="{ width: CELL_SIZE + 'px', height: CELL_SIZE + 'px' }"
                  >
                    <template v-if="cell">
                      <ObstacleTile v-if="cell.obstacle" :durability="cell.obstacle.durability" :size="CELL_SIZE - 4" />
                      <template v-else>
                        <VegetableIcon :color="cell.color" :size="CELL_SIZE - 6" />
                        <div v-if="cell.item" class="replay-item-overlay">
                          <ItemIcon :item="cell.item" :size="CELL_SIZE - 10" />
                        </div>
                      </template>
                    </template>
                  </div>
                </div>
              </template>
            </div>
            <!-- File labels (bottom: a,b,c,...,h) -->
            <div class="file-labels" :style="{ width: CELL_SIZE * 8 + 'px' }">
              <div
                v-for="(file, idx) in FILES" :key="file"
                :class="['coord-label', { 'coord-active': highlightCol === idx }]"
                :style="{ width: CELL_SIZE + 'px' }"
                @pointerenter="onFileHover(idx)"
                @pointerleave="clearHighlight"
                @click="onFileClick(idx)"
              >{{ file }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- Score display -->
      <div class="replay-score-bar">
        <span class="replay-score">{{ t('puzzle.score', { score: player.currentScore.value }) }}</span>
        <span class="replay-moves">{{ t('puzzle.moveCount', { count: player.currentMoveCount.value }) }}</span>
      </div>

      <!-- Controls -->
      <div class="replay-controls">
        <button class="icon-btn" @click="player.goTo(0)" :disabled="player.currentStep.value === 0 || player.isAnimating.value"><img :src="ctrlPrevTrackIcon" class="ctrl-icon" alt="" /></button>
        <button class="icon-btn" @click="player.prev()" :disabled="player.currentStep.value === 0 || player.isAnimating.value"><img :src="ctrlRewindIcon" class="ctrl-icon" alt="" /></button>
        <button class="icon-btn ctrl-play" @click="player.isPlaying.value ? player.pause() : player.play()">
          <img :src="player.isPlaying.value ? ctrlPauseIcon : ctrlPlayIcon" class="ctrl-icon" alt="" />
        </button>
        <button class="icon-btn" @click="player.next()" :disabled="player.currentStep.value >= player.totalSteps.value || player.isAnimating.value"><img :src="ctrlForwardIcon" class="ctrl-icon" alt="" /></button>
        <button class="icon-btn" @click="player.goTo(player.totalSteps.value)" :disabled="player.currentStep.value >= player.totalSteps.value || player.isAnimating.value"><img :src="ctrlNextTrackIcon" class="ctrl-icon" alt="" /></button>
      </div>

      <!-- Slider -->
      <div class="replay-slider">
        <input
          type="range"
          min="0"
          :max="player.totalSteps.value"
          :value="player.currentStep.value"
          @input="player.goTo(Number(($event.target as HTMLInputElement).value))"
        />
        <span class="slider-label">{{ player.currentStep.value }} / {{ player.totalSteps.value }}</span>
      </div>

      <!-- Speed selector -->
      <div class="replay-speed">
        <button
          v-for="opt in speedOptions"
          :key="opt.ms"
          :class="['speed-btn', { active: player.speed.value === opt.ms }]"
          @click="player.setSpeed(opt.ms)"
        >{{ opt.label }}</button>
      </div>

      <!-- Action list -->
      <div class="replay-actions-list">
        <div
          v-for="(action, i) in player.actions.value"
          :key="i"
          :class="['action-item', { current: i === player.currentStep.value - 1, next: i === player.currentStep.value }]"
          @click="player.goTo(i + 1)"
        >
          {{ actionLabel(action, i) }}
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.replay-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
}
.replay-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary);
}
.replay-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.btn-back {
  min-width: 40px;
  padding: 0 10px;
  font-size: 18px;
}
.replay-info {
  display: flex;
  flex-direction: column;
}
.replay-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
}
.replay-meta {
  font-size: 11px;
  color: var(--text-muted);
  font-family: monospace;
}
.replay-board-wrapper {
  display: flex;
  justify-content: center;
  margin-bottom: 8px;
}
.board-with-labels {
  display: flex;
  align-items: flex-start;
  gap: 2px;
}
.board-and-files {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.rank-labels {
  display: flex;
  flex-direction: column;
  /* Level with the board, which has a margin for its frame */
  margin-top: var(--board-frame-width);
}
.file-labels {
  display: flex;
}
.coord-label {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-muted);
  user-select: none;
  cursor: pointer;
  border-radius: 4px;
  transition: background 0.15s, color 0.15s;
}
.coord-label:hover, .coord-active {
  color: var(--brand);
  background: rgba(46, 125, 50, 0.1);
}
.cell-coord-highlight {
  background: rgba(46, 125, 50, 0.08);
}
.replay-board {
  display: flex;
  flex-direction: column;
  background: var(--board-bg);
  /* Room for the frame, which is drawn outside */
  margin: var(--board-frame-width);
  overflow: hidden;
}
.replay-row {
  display: flex;
}
.replay-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  border: 0.5px solid var(--border);
  box-sizing: border-box;
}
.cell-highlight {
  background: rgba(46, 125, 50, 0.15);
  box-shadow: inset 0 0 0 2px var(--brand);
}
.cell-matched {
  background: rgba(255, 200, 50, 0.4);
  animation: replay-match-pulse 0.35s ease both;
}
.cell-clearing {
  animation: replay-clear-out 0.25s ease forwards;
}
@keyframes replay-match-pulse {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.08); }
  100% { transform: scale(1); }
}
@keyframes replay-clear-out {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.3); }
}
.replay-item-overlay {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.replay-score-bar {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  margin-bottom: 8px;
}
.replay-score {
  font-size: 16px;
  font-weight: 700;
  color: var(--brand);
}
.replay-moves {
  font-size: 13px;
  color: var(--text-secondary);
}
.replay-controls {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin-bottom: 8px;
}
/* The controls are .icon-btn; play is the larger green one */
.ctrl-icon {
  width: 20px;
  height: 20px;
}
.ctrl-play {
  background: var(--brand);
  color: var(--on-brand);
  width: 52px;
  height: 52px;
}
.replay-slider {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  margin-bottom: 8px;
}
.replay-slider input[type="range"] {
  flex: 1;
  accent-color: var(--brand);
}
.slider-label {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 48px;
  text-align: right;
  font-family: monospace;
}
.replay-speed {
  display: flex;
  justify-content: center;
  gap: 4px;
  margin-bottom: 8px;
}
.speed-btn {
  min-height: 32px;
  padding: 2px 12px;
  border: var(--frame-thin);
  border-radius: 999px;
  background: var(--bg-card);
  font-size: 13px;
  font-weight: 800;
  color: var(--ink);
  cursor: pointer;
}
.speed-btn.active {
  background: var(--brand);
  color: var(--on-brand);
}
.replay-actions-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 0 4px;
}
.action-item {
  padding: 6px 8px;
  font-size: 12px;
  font-family: monospace;
  color: var(--text-secondary);
  border-radius: 4px;
  cursor: pointer;
}
.action-item:hover {
  background: var(--bg-card-alt);
}
.action-item.current {
  background: var(--rank-me-bg);
  color: var(--brand);
  font-weight: 700;
}
.action-item.next {
  background: rgba(46, 125, 50, 0.08);
  border-left: 2px solid var(--brand);
}
</style>
