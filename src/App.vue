<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { router } from './ui/routes';
import BottomNav from './ui/components/BottomNav.vue';
import ToastContainer from './ui/components/ToastContainer.vue';
import HandoffDialog from './ui/components/HandoffDialog.vue';
import { useGameStore } from './ui/stores/game';
import { flushOfflineQueue } from './ui/api/client';
import { initialHandoffToken } from './ui/lib/handoffToken';

const handoffToken = ref(initialHandoffToken);
const { route, component } = router;

onMounted(async () => {
  const gameStore = useGameStore();
  await gameStore.init();
  // Flush any offline-queued requests on startup
  flushOfflineQueue();
});
</script>

<template>
  <div class="app-container">
    <!-- No key: /puzzle/1 → /puzzle/2 keeps PuzzleView, which follows route.params.seed -->
    <component :is="component" v-if="component" />
    <BottomNav v-if="!route.meta.hideNav" />
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
