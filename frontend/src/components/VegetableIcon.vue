<script setup lang="ts">
import type { Color } from '@tomado/engine';

const props = defineProps<{
  color: Color;
  size: number;
}>();
</script>

<template>
  <!-- Color 0: Onion (round, upright, visible stripes) -->
  <svg v-if="color === 0" :width="size" :height="size" viewBox="0 0 48 48" fill="none">
    <!-- Round body with slight top taper -->
    <path d="M24 10 C24 10, 10 18, 8 28 C6 38, 12 46, 24 46 C36 46, 42 38, 40 28 C38 18, 24 10, 24 10Z" fill="#F5D45A" />
    <path d="M24 10 C24 10, 10 18, 8 28 C6 38, 12 46, 24 46 C36 46, 42 38, 40 28 C38 18, 24 10, 24 10Z" fill="url(#onion-grad)" />
    <!-- Vertical stripe lines (darker, more visible) -->
    <path d="M14 20 C12 28, 11 36, 13 44" stroke="#B89818" stroke-width="1.2" opacity="0.5" fill="none" />
    <path d="M19 15 C17 24, 16 34, 18 44" stroke="#B89818" stroke-width="1" opacity="0.45" fill="none" />
    <path d="M24 12 C24 22, 24 34, 24 44" stroke="#B89818" stroke-width="1.2" opacity="0.5" fill="none" />
    <path d="M29 15 C31 24, 32 34, 30 44" stroke="#B89818" stroke-width="1" opacity="0.45" fill="none" />
    <path d="M34 20 C36 28, 37 36, 35 44" stroke="#B89818" stroke-width="1.2" opacity="0.5" fill="none" />
    <!-- Highlight -->
    <ellipse cx="31" cy="28" rx="6" ry="9" fill="#fff" opacity="0.25" transform="rotate(-12 31 28)" />
    <defs>
      <radialGradient id="onion-grad" cx="0.4" cy="0.35" r="0.6">
        <stop offset="0%" stop-color="#FFF4B0" stop-opacity="0.6" />
        <stop offset="100%" stop-color="#D4A820" stop-opacity="0.3" />
      </radialGradient>
    </defs>
  </svg>

  <!-- Color 1: Cucumber (single, J-shaped curve) -->
  <svg v-else-if="color === 1" :width="size" :height="size" viewBox="0 0 48 48" fill="none">
    <!-- J-shaped body: straight top curving right at bottom -->
    <path d="M20 4 C17 4, 16 6, 15 10 C14 18, 14 26, 16 32 C18 37, 22 42, 28 44 C32 45, 35 43, 36 40 C37 37, 35 34, 32 30 C29 26, 28 18, 28 10 C28 6, 26 4, 24 4Z" fill="#5AAD5E" />
    <path d="M20 4 C17 4, 16 6, 15 10 C14 18, 14 26, 16 32 C18 37, 22 42, 28 44 C32 45, 35 43, 36 40 C37 37, 35 34, 32 30 C29 26, 28 18, 28 10 C28 6, 26 4, 24 4Z" fill="url(#cuke-grad)" />
    <!-- Bumps -->
    <circle cx="19" cy="14" r="0.9" fill="#3D8040" opacity="0.5" />
    <circle cx="24" cy="20" r="0.9" fill="#3D8040" opacity="0.5" />
    <circle cx="20" cy="28" r="0.9" fill="#3D8040" opacity="0.5" />
    <circle cx="25" cy="36" r="0.9" fill="#3D8040" opacity="0.4" />
    <!-- Highlight -->
    <ellipse cx="25" cy="18" rx="3" ry="9" fill="#fff" opacity="0.18" transform="rotate(-3 25 18)" />
    <!-- Stem -->
    <path d="M22 4 C21 1, 19 0, 17 1" stroke="#7BAF4C" stroke-width="1.5" fill="none" stroke-linecap="round" />
    <!-- Blossom end nub -->
    <circle cx="32" cy="43" r="1.2" fill="#4A9A4E" />
    <defs>
      <linearGradient id="cuke-grad" x1="15" y1="4" x2="28" y2="4">
        <stop offset="0%" stop-color="#72C576" stop-opacity="0.5" />
        <stop offset="50%" stop-color="#A0E0A0" stop-opacity="0.3" />
        <stop offset="100%" stop-color="#4A9A4E" stop-opacity="0.4" />
      </linearGradient>
    </defs>
  </svg>

  <!-- Color 2: Eggplant (large calyx, curved fat body, tilted 40deg) -->
  <svg v-else-if="color === 2" :width="size" :height="size" viewBox="0 0 48 48" fill="none">
    <g transform="rotate(40 24 24)">
      <!-- Curved fat body -->
      <path d="M22 14 C16 16, 10 22, 9 30 C8 38, 13 44, 22 46 C30 46, 36 40, 37 32 C38 24, 34 16, 28 14Z" fill="#7B4FAA" />
      <path d="M22 14 C16 16, 10 22, 9 30 C8 38, 13 44, 22 46 C30 46, 36 40, 37 32 C38 24, 34 16, 28 14Z" fill="url(#egg-grad)" />
      <!-- Glossy highlight -->
      <ellipse cx="30" cy="36" rx="7" ry="4" fill="#fff" opacity="0.35" transform="rotate(-25 30 36)" />
      <!-- Large calyx (star-shaped, bigger) -->
      <g fill="#5AAD5E" stroke="#3D7A30" stroke-width="0.8">
        <path d="M25 14 C24 10, 22 6, 20 4 C19 3, 18 4, 19 7 L22 14Z" />
        <path d="M25 14 C27 10, 30 7, 32 6 C33 6, 33 7, 31 9 L27 14Z" />
        <path d="M23 14 C20 11, 16 9, 14 9 C13 10, 14 11, 16 12 L22 14Z" />
        <path d="M26 14 C29 12, 33 11, 35 12 C35 13, 34 13, 32 13 L28 14Z" />
      </g>
      <!-- Stem -->
      <rect x="24" y="4" width="3" height="10" rx="1.5" fill="#2e7d32" transform="rotate(-5 25.5 9)" />
    </g>
    <defs>
      <radialGradient id="egg-grad" cx="0.35" cy="0.3" r="0.65">
        <stop offset="0%" stop-color="#A080D0" stop-opacity="0.5" />
        <stop offset="100%" stop-color="#5A3080" stop-opacity="0.3" />
      </radialGradient>
    </defs>
  </svg>

  <!-- Color 3: Tomato (same as favicon tomado-icon.svg) -->
  <svg v-else-if="color === 3" :width="size" :height="size" viewBox="0 0 128 128" fill="none">
    <ellipse cx="64" cy="74" rx="52" ry="46" fill="#e53935" />
    <ellipse cx="64" cy="74" rx="52" ry="46" fill="none" stroke="#c62828" stroke-width="1.5" />
    <ellipse cx="86" cy="94" rx="16" ry="6" fill="#fff" opacity="0.55" transform="rotate(-30 86 94)" />
    <g fill="#43a047">
      <path d="M64 44 Q56 8 48 28 L58 42Z" />
      <path d="M64 44 Q72 8 80 28 L70 42Z" />
      <path d="M56 46 Q24 14 34 38 L52 44Z" />
      <path d="M72 46 Q104 14 94 38 L76 44Z" />
    </g>
    <rect x="61.5" y="26" width="5" height="18" rx="2.5" fill="#2e7d32" />
  </svg>

  <!-- Color 4: Daikon (extra wide carrot shape, tapered, bushy leaves) -->
  <svg v-else :width="size" :height="size" viewBox="0 0 48 48" fill="none">
    <!-- Tapered body (gentler taper, not too sharp) -->
    <path d="M8 18 C7 24, 11 34, 16 40 C19 44, 22 46, 24 47 C26 46, 29 44, 32 40 C37 34, 41 24, 40 18 C40 14, 34 10, 24 10 C14 10, 8 14, 8 18Z" fill="#F0EDE6" />
    <path d="M8 18 C7 24, 11 34, 16 40 C19 44, 22 46, 24 47 C26 46, 29 44, 32 40 C37 34, 41 24, 40 18 C40 14, 34 10, 24 10 C14 10, 8 14, 8 18Z" fill="url(#dai-grad)" />
    <!-- Thin green collar at very top -->
    <path d="M8 18 C8 15, 14 12, 24 12 C34 12, 40 15, 40 18 C40 19, 34 19, 24 19 C14 19, 8 19, 8 18Z" fill="#A8D88A" opacity="0.6" />
    <!-- Root lines -->
    <line x1="18" y1="30" x2="18" y2="40" stroke="#D8D4CC" stroke-width="0.5" opacity="0.5" />
    <line x1="24" y1="26" x2="24" y2="44" stroke="#D8D4CC" stroke-width="0.5" opacity="0.4" />
    <line x1="30" y1="30" x2="30" y2="40" stroke="#D8D4CC" stroke-width="0.5" opacity="0.5" />
    <!-- Highlight -->
    <ellipse cx="32" cy="24" rx="5" ry="8" fill="#fff" opacity="0.2" transform="rotate(-8 32 24)" />
    <!-- Bushy leaves -->
    <path d="M24 10 C22 6, 17 0, 12 1" stroke="#5AAD5E" stroke-width="2.2" fill="none" stroke-linecap="round" />
    <path d="M24 10 C20 5, 14 2, 10 4" stroke="#7BAF4C" stroke-width="2" fill="none" stroke-linecap="round" />
    <path d="M24 10 C22 4, 20 0, 18 -1" stroke="#68B86C" stroke-width="1.8" fill="none" stroke-linecap="round" />
    <path d="M24 10 C26 6, 31 0, 36 1" stroke="#5AAD5E" stroke-width="2.2" fill="none" stroke-linecap="round" />
    <path d="M24 10 C28 5, 34 2, 38 4" stroke="#7BAF4C" stroke-width="2" fill="none" stroke-linecap="round" />
    <path d="M24 10 C26 4, 28 0, 30 -1" stroke="#68B86C" stroke-width="1.8" fill="none" stroke-linecap="round" />
    <!-- Leaf fills -->
    <path d="M22 6 C19 3, 15 1, 13 2 C15 3, 19 6, 22 9Z" fill="#7BAF4C" opacity="0.5" />
    <path d="M26 6 C29 3, 33 1, 35 2 C33 3, 29 6, 26 9Z" fill="#7BAF4C" opacity="0.5" />
    <defs>
      <linearGradient id="dai-grad" x1="8" y1="10" x2="40" y2="10">
        <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.4" />
        <stop offset="50%" stop-color="#FFFFFF" stop-opacity="0.1" />
        <stop offset="100%" stop-color="#D8D4CC" stop-opacity="0.3" />
      </linearGradient>
    </defs>
  </svg>
</template>
