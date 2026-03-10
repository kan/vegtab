<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';

const router = useRouter();
const route = useRoute();
const gameStore = useGameStore();
const { t } = useI18n();

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
      <svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <span class="nav-label">HOME</span>
    </button>
    <button
      :class="['nav-btn', { active: route.path.startsWith('/puzzle') }]"
      @click="goToPuzzle"
    >
      <svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span class="nav-label">PUZZLE</span>
    </button>
    <button
      :class="['nav-btn', { active: route.path === '/achievements' }]"
      @click="router.push('/achievements')"
    >
      <svg class="nav-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2"/><path d="M18 9h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2"/><path d="M6 3h12v7a6 6 0 0 1-12 0V3z"/><path d="M9 21h6"/><path d="M12 16v5"/></svg>
      <span class="nav-label">{{ t('achievement.title').toUpperCase() }}</span>
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
.nav-label {
  font-weight: 600;
}
.nav-icon-svg {
  width: 20px;
  height: 20px;
}
</style>
