<script setup lang="ts">
import type { Color } from '@vegtab/engine';
import { onionIcon, cucumberIcon, eggplantIcon, tomatoIcon, daikonIcon } from '@/assets/icons';

const props = defineProps<{
  color: Color;
  size: number;
  sparkle?: boolean;
}>();

const icons: Record<number, string> = {
  0: onionIcon,
  1: cucumberIcon,
  2: eggplantIcon,
  3: tomatoIcon,
  4: daikonIcon,
};
</script>

<template>
  <span v-if="sparkle" class="sparkle-wrapper" :style="{ width: size + 'px', height: size + 'px' }">
    <img :src="icons[color]" :width="size" :height="size" alt="" draggable="false" />
    <svg class="sparkle-star" :width="size * 0.4" :height="size * 0.4" viewBox="0 0 20 20">
      <path d="M10 0l2.5 7.5L20 10l-7.5 2.5L10 20l-2.5-7.5L0 10l7.5-2.5z" fill="#FFD600" opacity="0.9"/>
    </svg>
  </span>
  <img v-else :src="icons[color]" :width="size" :height="size" alt="" draggable="false" />
</template>

<style scoped>
.sparkle-wrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.sparkle-star {
  position: absolute;
  top: -2px;
  right: -2px;
  pointer-events: none;
  animation: sparkle-twinkle 1.2s ease-in-out infinite;
  filter: drop-shadow(0 0 3px rgba(255, 214, 0, 0.7));
}
@keyframes sparkle-twinkle {
  0%, 100% { opacity: 0.5; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.1); }
}
</style>
