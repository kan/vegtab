<script setup lang="ts">
defineProps<{ item: string; size: number }>();
</script>

<template>
  <!-- 虫めがね -->
  <svg v-if="item === 'magnifying_glass'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <!-- レンズ -->
    <circle cx="14" cy="14" r="8" fill="none" stroke="#5b9bd5" stroke-width="2"/>
    <circle cx="14" cy="14" r="5" fill="#d6eaf8" opacity="0.5"/>
    <!-- 柄 -->
    <line x1="20" y1="20" x2="28" y2="28" stroke="#8b6914" stroke-width="3" stroke-linecap="round"/>
    <!-- レンズの光沢 -->
    <path d="M10 10 Q11 8 13 9" stroke="#fff" stroke-width="1.2" fill="none" stroke-linecap="round"/>
  </svg>

  <!-- はさみ: 刃が下を向いている (エフェクトが上→下なので) -->
  <svg v-else-if="item === 'scissors'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <!-- 左の持ち手 -->
    <ellipse cx="11" cy="8" rx="3.5" ry="4" fill="none" stroke="#888" stroke-width="1.6" stroke-linecap="round"/>
    <!-- 右の持ち手 -->
    <ellipse cx="21" cy="8" rx="3.5" ry="4" fill="none" stroke="#888" stroke-width="1.6" stroke-linecap="round"/>
    <!-- 結合部 (ネジ) -->
    <circle cx="16" cy="15.5" r="2" fill="#999" stroke="#777" stroke-width="0.6"/>
    <!-- 左の刃 (下向き) -->
    <path d="M12 28 L10 16 L14 16 Z" fill="#e06b6b" stroke="#c85a5a" stroke-width="0.8"/>
    <!-- 右の刃 (下向き) -->
    <path d="M20 28 L18 16 L22 16 Z" fill="#e06b6b" stroke="#c85a5a" stroke-width="0.8"/>
  </svg>

  <!-- カッター: はさみを90度回転（横向き） -->
  <svg v-else-if="item === 'cutter'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <g transform="rotate(-90 16 16)">
      <!-- 左の持ち手 -->
      <ellipse cx="11" cy="8" rx="3.5" ry="4" fill="none" stroke="#888" stroke-width="1.6" stroke-linecap="round"/>
      <!-- 右の持ち手 -->
      <ellipse cx="21" cy="8" rx="3.5" ry="4" fill="none" stroke="#888" stroke-width="1.6" stroke-linecap="round"/>
      <!-- 結合部 (ネジ) -->
      <circle cx="16" cy="15.5" r="2" fill="#999" stroke="#777" stroke-width="0.6"/>
      <!-- 左の刃 (下向き) -->
      <path d="M12 28 L10 16 L14 16 Z" fill="#e06b6b" stroke="#c85a5a" stroke-width="0.8"/>
      <!-- 右の刃 (下向き) -->
      <path d="M20 28 L18 16 L22 16 Z" fill="#e06b6b" stroke="#c85a5a" stroke-width="0.8"/>
    </g>
  </svg>

  <!-- クリップ: ゼムクリップ風 -->
  <svg v-else-if="item === 'clip'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <path
      d="M12 28 L12 8 Q12 3 16 3 Q20 3 20 8 L20 24 Q20 27 17 27 Q14 27 14 24 L14 10"
      stroke="#999" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"
    />
  </svg>

  <!-- コーヒーカップ: 横から見た図 -->
  <svg v-else-if="item === 'coffee'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <!-- 湯気 -->
    <path d="M10 8 Q11 5 10 2" stroke="#bbb" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M15 7 Q16 4 15 1" stroke="#bbb" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M20 8 Q21 5 20 2" stroke="#bbb" stroke-width="1" fill="none" stroke-linecap="round"/>
    <!-- カップ本体 -->
    <path d="M5 11 L7 26 Q15 30 23 26 L25 11 Z" fill="#fff" stroke="#c0392b" stroke-width="1.2"/>
    <!-- 取っ手 -->
    <path d="M25 14 Q30 14 30 19 Q30 24 25 23" fill="none" stroke="#c0392b" stroke-width="1.5" stroke-linecap="round"/>
    <!-- カップの帯ライン -->
    <path d="M6 16 Q15 18 24 16" stroke="#c0392b" stroke-width="0.8" fill="none"/>
  </svg>
</template>
