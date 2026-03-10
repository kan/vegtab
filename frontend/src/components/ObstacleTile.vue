<script setup lang="ts">
const props = defineProps<{
  durability: number;
  size: number;
}>();
</script>

<template>
  <div
    class="obstacle-tile"
    :style="{
      width: size + 'px',
      height: size + 'px',
      '--crack-opacity': durability <= 1 ? '0.6' : durability <= 2 ? '0.3' : '0',
    }"
  >
    <svg :width="size" :height="size" viewBox="0 0 48 48" fill="none">
      <!-- Stone base -->
      <rect x="3" y="3" width="42" height="42" rx="4" fill="#9E9E9E" />
      <rect x="3" y="3" width="42" height="42" rx="4" fill="url(#stone-grad)" />

      <!-- Surface texture -->
      <rect x="6" y="6" width="36" height="36" rx="2" fill="none" stroke="#888" stroke-width="0.5" opacity="0.4" />

      <!-- Cracks at lower durability -->
      <g v-if="durability <= 2" :opacity="durability <= 1 ? 0.7 : 0.4">
        <path d="M15 10 L22 20 L18 28" stroke="#666" stroke-width="1.5" fill="none" stroke-linecap="round" />
        <path d="M33 12 L28 22 L32 30" stroke="#666" stroke-width="1.2" fill="none" stroke-linecap="round" />
      </g>
      <g v-if="durability <= 1" opacity="0.6">
        <path d="M10 20 L20 24 L12 36" stroke="#555" stroke-width="1.5" fill="none" stroke-linecap="round" />
        <path d="M36 18 L30 28 L38 38" stroke="#555" stroke-width="1.2" fill="none" stroke-linecap="round" />
        <path d="M18 38 L24 32 L30 40" stroke="#555" stroke-width="1" fill="none" stroke-linecap="round" />
      </g>

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

      <defs>
        <linearGradient id="stone-grad" x1="3" y1="3" x2="45" y2="45">
          <stop offset="0%" stop-color="#BDBDBD" />
          <stop offset="50%" stop-color="#9E9E9E" />
          <stop offset="100%" stop-color="#757575" />
        </linearGradient>
      </defs>
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
