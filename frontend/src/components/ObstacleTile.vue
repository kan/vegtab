<script setup lang="ts">
import { computed } from 'vue';
import { useTheme } from '../theme';

const COLORS_LIGHT = ['#9E9E9E', '#757575', '#545454'] as const;
const COLORS_DARK  = ['#545454', '#757575', '#9E9E9E'] as const;

const props = defineProps<{
  durability: number;
  size: number;
}>();

const { isDark } = useTheme();

const fillColor = computed(() => {
  const colors = isDark.value ? COLORS_DARK : COLORS_LIGHT;
  return colors[Math.max(0, Math.min(props.durability, 3) - 1)];
});
</script>

<template>
  <div
    class="obstacle-tile"
    :style="{ width: size + 'px', height: size + 'px' }"
  >
    <svg :width="size" :height="size" viewBox="0 0 48 48" fill="none">
      <rect x="3" y="3" width="42" height="42" rx="4" :fill="fillColor" />

      <!-- Durability number: dark outline for contrast -->
      <text
        x="24" y="28"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="22"
        font-weight="900"
        fill="none"
        stroke="#333"
        stroke-width="4"
        stroke-linejoin="round"
        paint-order="stroke"
      >{{ durability }}</text>
      <!-- Durability number: white fill on top -->
      <text
        x="24" y="28"
        text-anchor="middle"
        dominant-baseline="middle"
        font-size="22"
        font-weight="900"
        fill="#fff"
      >{{ durability }}</text>
    </svg>
  </div>
</template>

<style scoped>
.obstacle-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
</style>
