<script setup lang="ts">
import type { Color } from '@vegtab/engine';
import { onionIcon, cucumberIcon, eggplantIcon, tomatoIcon, daikonIcon } from '@/assets/icons';

const props = defineProps<{
  color: Color;
  size: number;
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
  <img :src="icons[color]" :width="size" :height="size" alt="" draggable="false" />
</template>
