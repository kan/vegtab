<script setup lang="ts">
import { spoonIcon, scissorsIcon, forkKnifeIcon, saladIcon } from '@/assets/icons';

defineProps<{ item: string; size: number }>();

const icons: Record<string, string> = {
  scope: spoonIcon,
  v_cut: scissorsIcon,
  h_cut: scissorsIcon,
  burst: forkKnifeIcon,
  flush: saladIcon,
};
</script>

<template>
  <img
    :src="icons[item]"
    :width="size"
    :height="size"
    :style="item === 'h_cut' ? { transform: 'rotate(90deg)' } : undefined"
    alt=""
    draggable="false"
  />
</template>
