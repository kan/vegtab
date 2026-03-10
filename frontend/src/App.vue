<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import BottomNav from './components/BottomNav.vue';
import ToastContainer from './components/ToastContainer.vue';
import { useGameStore } from './stores/game';
import { flushOfflineQueue } from './api/client';

const router = useRouter();

onMounted(async () => {
  const gameStore = useGameStore();
  await gameStore.init();
  // Flush any offline-queued requests on startup
  flushOfflineQueue();
});
</script>

<template>
  <div class="app-container">
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
    <BottomNav />
    <ToastContainer />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 480px;
  margin: 0 auto;
  background: var(--bg-page);
}
</style>
