<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useTodoStore } from '@/stores/todo';

const router = useRouter();
const todoStore = useTodoStore();
const seedInput = ref('');

function playDaily() {
  const today = new Date().toISOString().slice(0, 10);
  // Simple hash of date string as daily seed
  let hash = 0;
  for (let i = 0; i < today.length; i++) {
    hash = ((hash << 5) - hash + today.charCodeAt(i)) | 0;
  }
  router.push(`/puzzle/${Math.abs(hash)}`);
}

function playWithSeed() {
  const seed = parseInt(seedInput.value, 10);
  if (!isNaN(seed) && seed > 0) {
    router.push(`/puzzle/${seed}`);
  }
}

function playRandom() {
  router.push('/puzzle');
}
</script>

<template>
  <div class="home-view">
    <div class="hero">
      <h1 class="app-title">Tomado</h1>
      <p class="app-subtitle">TODO x 3-Match Puzzle</p>
    </div>

    <div class="dashboard">
      <div class="stat-card">
        <span class="stat-value">{{ todoStore.dailyCompleted }}</span>
        <span class="stat-label">Today's TODOs</span>
      </div>
      <div class="stat-card">
        <span class="stat-value">5</span>
        <span class="stat-label">Stamina</span>
      </div>
    </div>

    <div class="actions">
      <button class="btn btn-primary" @click="playDaily">
        Daily Puzzle
      </button>
      <button class="btn" @click="playRandom">
        Random Puzzle
      </button>
      <div class="seed-input-row">
        <input
          v-model="seedInput"
          class="seed-input"
          type="number"
          placeholder="Seed..."
        />
        <button class="btn btn-small" @click="playWithSeed">GO</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.home-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 24px 16px;
  overflow-y: auto;
}
.hero {
  text-align: center;
  padding: 32px 0 24px;
}
.app-title {
  font-size: 36px;
  color: #c0392b;
  font-weight: 800;
  letter-spacing: -1px;
}
.app-subtitle {
  font-size: 13px;
  color: #888;
  margin-top: 4px;
}
.dashboard {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
}
.stat-card {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.stat-value {
  display: block;
  font-size: 28px;
  font-weight: 700;
  color: #333;
}
.stat-label {
  font-size: 11px;
  color: #999;
}
.actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.btn {
  padding: 14px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  background: #fff;
  color: #333;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.btn-primary {
  background: #c0392b;
  color: #fff;
}
.btn-small {
  padding: 10px 16px;
  font-size: 14px;
}
.seed-input-row {
  display: flex;
  gap: 8px;
}
.seed-input {
  flex: 1;
  padding: 12px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 15px;
  background: #fff;
}
</style>
