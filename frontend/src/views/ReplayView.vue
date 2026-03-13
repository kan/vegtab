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
import { prevTrackIcon, rewindIcon, pauseIcon, playIcon, fastForwardIcon, nextTrackIcon } from '@/assets/icons';
import type { GameMode } from '@tomado/engine';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();

const loading = ref(true);
const error = ref('');
const replayMode = ref<GameMode>('sprint');
const replaySeed = ref(0);

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
      mode: GameMode;
      moveLimit: number | null;
    }>(`/api/scores/${scoreId}/replay`);

    replayMode.value = data.mode;
    replaySeed.value = data.seed;
    player.load(data.seed, data.mode, data.replayLog, {
      moveLimit: data.moveLimit ?? undefined,
    });
    loading.value = false;
  } catch {
    error.value = t('replay.loadError');
    loading.value = false;
  }
});

function actionLabel(action: ReplayAction, index: number): string {
  const num = index + 1;
  if (action.type === 'swap') {
    const dirLabel = t(`replay.dir_${action.dir}`);
    return `${num}. (${action.pos.row},${action.pos.col}) ${dirLabel}`;
  }
  if (action.type === 'tap') {
    return `${num}. (${action.pos.row},${action.pos.col}) ${t('replay.tap')}`;
  }
  if (action.type === 'scope') {
    return `${num}. (${action.pos.row},${action.pos.col}) ${t('replay.scope')}`;
  }
  if (action.type === 'scope_synthesis') {
    return `${num}. (${action.pos1.row},${action.pos1.col})+(${action.pos2.row},${action.pos2.col}) ${t('replay.scope')}`;
  }
  if (action.type === 'scope_swap') {
    const dirLabel = t(`replay.dir_${action.dir}`);
    return `${num}. (${action.pos.row},${action.pos.col}) ${dirLabel} + ${t('replay.scope')}`;
  }
  if (action.type === 'auto_activate') {
    return `${num}. ${t('replay.autoActivate')}`;
  }
  return `${num}. ???`;
}

const speedOptions = [
  { label: '0.5x', ms: 2000 },
  { label: '1x', ms: 1000 },
  { label: '2x', ms: 500 },
  { label: '4x', ms: 250 },
];

function getCellClass(row: number, col: number): string {
  const action = player.nextAction.value;
  if (!action) return '';
  if (action.type === 'scope_synthesis') {
    if ((action.pos1.row === row && action.pos1.col === col)
      || (action.pos2.row === row && action.pos2.col === col)) return 'cell-highlight';
  } else if ('pos' in action) {
    if (action.pos.row === row && action.pos.col === col) return 'cell-highlight';
  }
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
      <button class="btn" @click="router.push('/')">{{ t('common.home') }}</button>
    </div>

    <!-- Replay -->
    <template v-else>
      <header class="replay-header">
        <button class="btn-back" @click="router.back()">&larr;</button>
        <div class="replay-info">
          <span class="replay-title">{{ t('replay.title') }}</span>
          <span class="replay-meta">{{ t('common.seed', { seed: replaySeed }) }} &middot; {{ t(`mode.${replayMode}`) }}</span>
        </div>
      </header>

      <!-- Board -->
      <div class="replay-board-wrapper">
        <div class="replay-board" :style="{ width: CELL_SIZE * 8 + 'px', height: CELL_SIZE * 8 + 'px' }">
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
      </div>

      <!-- Score display -->
      <div class="replay-score-bar">
        <span class="replay-score">{{ t('puzzle.score', { score: player.currentScore.value }) }}</span>
        <span class="replay-moves">{{ t('puzzle.moveCount', { count: player.currentMoveCount.value }) }}</span>
      </div>

      <!-- Controls -->
      <div class="replay-controls">
        <button class="ctrl-btn" @click="player.goTo(0)" :disabled="player.currentStep.value === 0"><img :src="prevTrackIcon" class="ctrl-icon" alt="" /></button>
        <button class="ctrl-btn" @click="player.prev()" :disabled="player.currentStep.value === 0"><img :src="rewindIcon" class="ctrl-icon" alt="" /></button>
        <button class="ctrl-btn ctrl-play" @click="player.isPlaying.value ? player.pause() : player.play()">
          <img :src="player.isPlaying.value ? pauseIcon : playIcon" class="ctrl-icon" alt="" />
        </button>
        <button class="ctrl-btn" @click="player.next()" :disabled="player.currentStep.value >= player.totalSteps.value"><img :src="fastForwardIcon" class="ctrl-icon" alt="" /></button>
        <button class="ctrl-btn" @click="player.goTo(player.totalSteps.value)" :disabled="player.currentStep.value >= player.totalSteps.value"><img :src="nextTrackIcon" class="ctrl-icon" alt="" /></button>
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
  background: none;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 4px 10px;
  font-size: 16px;
  cursor: pointer;
  color: var(--text-primary);
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
.replay-board {
  display: flex;
  flex-direction: column;
  background: var(--bg-card-alt);
  border-radius: 8px;
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
.ctrl-btn {
  width: 40px;
  height: 40px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  font-size: 16px;
  cursor: pointer;
  color: var(--text-primary);
  display: flex;
  align-items: center;
  justify-content: center;
}
.ctrl-icon {
  width: 20px;
  height: 20px;
}
.ctrl-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.ctrl-play {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
  width: 48px;
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
  padding: 4px 12px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
}
.speed-btn.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
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
.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  background: var(--brand);
  color: #fff;
  font-size: 14px;
}
</style>
