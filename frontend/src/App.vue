<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import BottomNav from './components/BottomNav.vue';
import { useGameStore } from './stores/game';
import { useTodoStore } from './stores/todo';

const router = useRouter();

onMounted(async () => {
  const gameStore = useGameStore();
  await gameStore.init();
  const todoStore = useTodoStore();
  await todoStore.syncFromServer();
});
</script>

<template>
  <div class="app-container">
    <router-view v-slot="{ Component }">
      <component :is="Component" />
    </router-view>
    <BottomNav />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  flex-direction: column;
  height: 100dvh;
  max-width: 480px;
  margin: 0 auto;
  background: #f5f0e8;
}
</style>
