<script setup lang="ts">
import { spoonIcon, knifeIcon, forkKnifeIcon, saladIcon } from '@/assets/icons';

defineProps<{ item: string; size: number }>();

const icons: Record<string, string> = {
  scope: spoonIcon,
  v_cut: knifeIcon,
  h_cut: knifeIcon,
  burst: forkKnifeIcon,
  flush: saladIcon,
};
</script>

<template>
  <img
    :src="icons[item]"
    :width="size"
    :height="size"
    :style="item === 'v_cut' ? { transform: 'rotate(90deg)' } : undefined"
    alt=""
    draggable="false"
  />
</template>
