<script setup lang="ts">
import { useRouter } from 'vue-router';
import BottomNav from './components/BottomNav.vue';

const router = useRouter();
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
