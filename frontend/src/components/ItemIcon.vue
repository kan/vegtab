<script setup lang="ts">
defineProps<{ item: string; size: number }>();
</script>

<template>
  <!-- スプーン (scope) — 柄上・頭下、全体45度回転 -->
  <svg v-if="item === 'scope'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <g transform="rotate(45 16 16)">
      <!-- 柄（まっすぐ上） -->
      <rect x="14.5" y="1" width="3" height="13" rx="1.5" fill="#B0B0B0" stroke="#888" stroke-width="0.8"/>
      <!-- スプーンの頭（楕円、下） -->
      <ellipse cx="16" cy="22.5" rx="7" ry="7.5" fill="#C0C0C0" stroke="#888" stroke-width="1.2"/>
      <!-- 内側のくぼみ -->
      <ellipse cx="16" cy="22" rx="4.5" ry="4.8" fill="#D8D8D8"/>
      <!-- 光沢 -->
      <ellipse cx="14.5" cy="20.5" rx="2" ry="2.2" fill="#fff" opacity="0.4"/>
    </g>
  </svg>

  <!-- ナイフ縦 (v_cut) — 刃は直角三角形の斜辺を膨らませたカーブ -->
  <svg v-else-if="item === 'v_cut'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <!-- 刃: 先端(上)→カーブした刃先(右に膨らむ斜辺)→底辺→背(直線) -->
    <path d="M15 2 Q26 11 22 20 L15 20 Z" fill="#D0D0D0" stroke="#999" stroke-width="0.8"/>
    <!-- 刃の光沢 -->
    <path d="M15 4 Q22 10 20 18 L15 18 Z" fill="#EAEAEA" opacity="0.5"/>
    <!-- 背（直線、左辺の強調） -->
    <line x1="15" y1="2" x2="15" y2="20" stroke="#aaa" stroke-width="0.6"/>
    <!-- 柄 -->
    <rect x="13" y="20" width="5" height="10" rx="1" fill="#8B6914" stroke="#6B4E10" stroke-width="0.8"/>
    <!-- 柄の飾り -->
    <line x1="13.5" y1="23" x2="17.5" y2="23" stroke="#A07818" stroke-width="0.6"/>
    <line x1="13.5" y1="25.5" x2="17.5" y2="25.5" stroke="#A07818" stroke-width="0.6"/>
  </svg>

  <!-- ナイフ横 (h_cut): ナイフを90度回転 -->
  <svg v-else-if="item === 'h_cut'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <g transform="rotate(-90 16 16)">
      <path d="M15 2 Q26 11 22 20 L15 20 Z" fill="#D0D0D0" stroke="#999" stroke-width="0.8"/>
      <path d="M15 4 Q22 10 20 18 L15 18 Z" fill="#EAEAEA" opacity="0.5"/>
      <line x1="15" y1="2" x2="15" y2="20" stroke="#aaa" stroke-width="0.6"/>
      <rect x="13" y="20" width="5" height="10" rx="1" fill="#8B6914" stroke="#6B4E10" stroke-width="0.8"/>
      <line x1="13.5" y1="23" x2="17.5" y2="23" stroke="#A07818" stroke-width="0.6"/>
      <line x1="13.5" y1="25.5" x2="17.5" y2="25.5" stroke="#A07818" stroke-width="0.6"/>
    </g>
  </svg>

  <!-- フォーク (burst) — 柄上・歯下、全体45度回転 -->
  <svg v-else-if="item === 'burst'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <g transform="rotate(45 16 16)">
      <!-- 柄（まっすぐ上） -->
      <rect x="14.5" y="1" width="3" height="13" rx="1.5" fill="#B0B0B0" stroke="#888" stroke-width="0.8"/>
      <!-- 歯のつなぎ -->
      <path d="M8 17 Q8 15 12 15 L20 15 Q24 15 24 17" fill="none" stroke="#B0B0B0" stroke-width="2.2"/>
      <!-- 4本の歯（下向き） -->
      <rect x="9" y="17" width="2" height="11" rx="1" fill="#C0C0C0" stroke="#888" stroke-width="0.6"/>
      <rect x="13" y="17" width="2" height="11" rx="1" fill="#C0C0C0" stroke="#888" stroke-width="0.6"/>
      <rect x="17" y="17" width="2" height="11" rx="1" fill="#C0C0C0" stroke="#888" stroke-width="0.6"/>
      <rect x="21" y="17" width="2" height="11" rx="1" fill="#C0C0C0" stroke="#888" stroke-width="0.6"/>
    </g>
  </svg>

  <!-- 鍋 (flush) — 丸みのある暖色系 -->
  <svg v-else-if="item === 'flush'" :width="size" :height="size" viewBox="0 0 32 32" fill="none">
    <!-- 湯気 -->
    <path d="M11 8 Q12 5 11 2" stroke="#daa" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M16 7 Q17 4 16 1" stroke="#daa" stroke-width="1" fill="none" stroke-linecap="round"/>
    <path d="M21 8 Q22 5 21 2" stroke="#daa" stroke-width="1" fill="none" stroke-linecap="round"/>
    <!-- 鍋本体（丸みのある形状） -->
    <path d="M4 12 Q3 20 6 26 Q16 31 26 26 Q29 20 28 12 Z" fill="#C06030" stroke="#8B4020" stroke-width="1.2"/>
    <!-- 蓋の帯ライン -->
    <path d="M5 15 Q16 17 27 15" stroke="#A05028" stroke-width="0.8" fill="none"/>
    <!-- 左取っ手 -->
    <path d="M4 15 Q0 15 0 18 Q0 21 4 21" fill="none" stroke="#8B4020" stroke-width="1.8" stroke-linecap="round"/>
    <!-- 右取っ手 -->
    <path d="M28 15 Q32 15 32 18 Q32 21 28 21" fill="none" stroke="#8B4020" stroke-width="1.8" stroke-linecap="round"/>
    <!-- ハイライト -->
    <ellipse cx="13" cy="20" rx="4" ry="3" fill="#D07040" opacity="0.4"/>
  </svg>
</template>
