<script setup lang="ts">
import AchievementList from '@/components/AchievementList.vue';
</script>

<template>
  <div class="achievement-view">
    <AchievementList />
  </div>
</template>

<style scoped>
.achievement-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 20px;
  overflow-y: auto;
}
</style>
