<script setup lang="ts">
import { onMounted, ref } from 'vue';
import BottomNav from './components/BottomNav.vue';
import ToastContainer from './components/ToastContainer.vue';
import HandoffDialog from './components/HandoffDialog.vue';
import { useGameStore } from './stores/game';
import { flushOfflineQueue } from './api/client';
import { initialHandoffToken } from './lib/handoffToken';

const handoffToken = ref(initialHandoffToken);

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
    <HandoffDialog v-if="handoffToken" :token="handoffToken" @close="handoffToken = null" />
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
