<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const route = useRoute();
const gameStore = useGameStore();

function goToPuzzle() {
  const seed = gameStore.generateDailySeed();
  // Navigate without mode query so the mode selector shows
  router.push(`/puzzle/${seed}`);
}
</script>

<template>
  <nav class="bottom-nav">
    <button
      :class="['nav-btn', { active: route.path === '/' }]"
      @click="router.push('/')"
    >
      <span class="nav-icon">&#x2302;</span>
      <span class="nav-label">HOME</span>
    </button>
    <button
      :class="['nav-btn', { active: route.path.startsWith('/puzzle') }]"
      @click="goToPuzzle"
    >
      <span class="nav-icon">&#x25A6;</span>
      <span class="nav-label">PUZZLE</span>
    </button>
  </nav>
</template>

<style scoped>
.bottom-nav {
  display: flex;
  border-top: 1px solid var(--board-nav-border);
  background: var(--bg-card);
  padding: 4px 0;
  flex-shrink: 0;
}
.nav-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0;
  border: none;
  background: none;
  color: var(--text-muted);
  font-size: 10px;
  cursor: pointer;
  transition: color 0.15s;
}
.nav-btn.active {
  color: var(--brand);
}
.nav-icon {
  font-size: 20px;
}
.nav-label {
  font-weight: 600;
}
</style>
