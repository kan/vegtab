<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { usePuzzleStore } from '@/stores/puzzle';
import PuzzleBoard from '@/components/PuzzleBoard.vue';
import DebugPanel from '@/components/DebugPanel.vue';

const isDev = import.meta.env.DEV;

const store = usePuzzleStore();
const route = useRoute();
const debugPanel = ref<InstanceType<typeof DebugPanel> | null>(null);
const puzzleBoard = ref<InstanceType<typeof PuzzleBoard> | null>(null);

onMounted(() => {
  const seedParam = route.params.seed;
  const seed = seedParam ? Number(seedParam) : undefined;
  if (!store.gameState || (seed !== undefined && seed !== store.seed)) {
    store.startGame(seed);
  }
});

function restart() {
  store.startGame(store.seed);
}

function newGame() {
  store.startGame();
}
</script>

<template>
  <div class="puzzle-view">
    <header class="puzzle-header">
      <div class="header-row">
        <div class="seed-label">SEED: {{ store.seed }}</div>
        <div class="score-label">SCORE: {{ store.score }}</div>
      </div>
      <div class="header-row">
        <div class="move-label">MOVE: {{ store.moveCount }}</div>
        <button v-if="store.canUndo" class="btn-undo" @click="store.undo()">UNDO</button>
      </div>
    </header>

    <div class="board-area">
      <PuzzleBoard ref="puzzleBoard" :debug-panel="debugPanel" />
    </div>

    <div v-if="store.isGameOver" class="game-over-overlay">
      <div class="game-over-card">
        <h2>GAME OVER</h2>
        <p class="final-score">{{ store.score }} pts</p>
        <div class="game-over-actions">
          <button class="btn" @click="restart">RETRY</button>
          <button class="btn btn-secondary" @click="newGame">NEW GAME</button>
        </div>
      </div>
    </div>

    <footer class="puzzle-footer">
      <button class="btn btn-small" @click="restart">RETRY</button>
      <button class="btn btn-small btn-secondary" @click="newGame">NEW</button>
    </footer>

    <DebugPanel v-if="isDev" ref="debugPanel" />
  </div>
</template>

<style scoped>
.puzzle-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 12px;
  overflow: hidden;
  position: relative;
}
.puzzle-header {
  margin-bottom: 12px;
}
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
}
.seed-label {
  font-size: 11px;
  color: #888;
  font-family: monospace;
}
.score-label {
  font-size: 20px;
  font-weight: 700;
  color: #c0392b;
}
.move-label {
  font-size: 13px;
  color: #666;
}
.btn-undo {
  padding: 4px 12px;
  border: 1px solid #c0392b;
  background: #fff;
  color: #c0392b;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.board-area {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
.puzzle-footer {
  display: flex;
  gap: 8px;
  justify-content: center;
  padding: 12px 0 0;
}
.btn {
  padding: 10px 24px;
  border: none;
  border-radius: 6px;
  font-weight: 600;
  cursor: pointer;
  background: #c0392b;
  color: #fff;
  font-size: 14px;
}
.btn-secondary {
  background: #7f8c8d;
}
.btn-small {
  padding: 6px 16px;
  font-size: 12px;
}
.game-over-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}
.game-over-card {
  background: #fff;
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}
.game-over-card h2 {
  font-size: 24px;
  color: #c0392b;
  margin-bottom: 8px;
}
.final-score {
  font-size: 36px;
  font-weight: 700;
  color: #333;
  margin-bottom: 20px;
}
.game-over-actions {
  display: flex;
  gap: 12px;
  justify-content: center;
}
</style>
