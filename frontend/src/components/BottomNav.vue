<script setup lang="ts">
import { useRouter, useRoute } from 'vue-router';

const router = useRouter();
const route = useRoute();

const tabs = [
  { path: '/', label: 'HOME', icon: '\u2302' },
  { path: '/todo', label: 'TODO', icon: '\u2611' },
  { path: '/puzzle', label: 'PUZZLE', icon: '\u25A6' },
];
</script>

<template>
  <nav class="bottom-nav">
    <button
      v-for="tab in tabs"
      :key="tab.path"
      :class="['nav-btn', { active: route.path === tab.path || (tab.path !== '/' && route.path.startsWith(tab.path)) }]"
      @click="router.push(tab.path)"
    >
      <span class="nav-icon">{{ tab.icon }}</span>
      <span class="nav-label">{{ tab.label }}</span>
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
