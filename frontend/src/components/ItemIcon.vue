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
    :style="item === 'v_cut' ? { transform: 'rotate(135deg)' } : item === 'h_cut' ? { transform: 'rotate(45deg)' } : undefined"
    alt=""
    draggable="false"
  />
</template>
