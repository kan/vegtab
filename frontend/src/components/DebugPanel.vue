<script setup lang="ts">
import { ref, watchEffect } from 'vue';
import { usePuzzleStore } from '@/stores/puzzle';
import type { ItemType } from '@tomado/engine';
import ItemIcon from './ItemIcon.vue';

const store = usePuzzleStore();

type PlaceMode =
  | { type: 'single'; item: ItemType }
  | { type: 'pair'; items: [ItemType, ItemType] };

const collapsed = ref(true);
const pendingPlace = ref<PlaceMode | null>(null);
const placedFirst = ref<{ row: number; col: number } | null>(null);

const items: ItemType[] = ['magnifying_glass', 'scissors', 'cutter', 'clip', 'coffee'];

const pairs: { label: string; items: [ItemType, ItemType] }[] = [
  { label: 'Mag+Mag', items: ['magnifying_glass', 'magnifying_glass'] },
  { label: 'Mag+Sci', items: ['magnifying_glass', 'scissors'] },
  { label: 'Mag+Cut', items: ['magnifying_glass', 'cutter'] },
  { label: 'Mag+Clip', items: ['magnifying_glass', 'clip'] },
  { label: 'Mag+Cof', items: ['magnifying_glass', 'coffee'] },
  { label: 'Line+Line', items: ['scissors', 'scissors'] },
  { label: 'Sci+Clip', items: ['scissors', 'clip'] },
  { label: 'Cut+Clip', items: ['cutter', 'clip'] },
  { label: 'Clip+Clip', items: ['clip', 'clip'] },
  { label: 'Cof+Sci', items: ['coffee', 'scissors'] },
  { label: 'Cof+Cut', items: ['coffee', 'cutter'] },
  { label: 'Cof+Clip', items: ['coffee', 'clip'] },
  { label: 'Cof+Cof', items: ['coffee', 'coffee'] },
];

function toggle() {
  collapsed.value = !collapsed.value;
}

function selectSingle(item: ItemType) {
  placedFirst.value = null;
  pendingPlace.value = { type: 'single', item };
}

function selectPair(pair: [ItemType, ItemType]) {
  placedFirst.value = null;
  pendingPlace.value = { type: 'pair', items: pair };
}

function cancel() {
  pendingPlace.value = null;
  placedFirst.value = null;
}

defineExpose({
  /** Called by PuzzleBoard when a cell is tapped while debug place is active */
  handleCellTap(row: number, col: number): boolean {
    if (!pendingPlace.value) return false;

    if (pendingPlace.value.type === 'single') {
      store.placeItem({ row, col }, pendingPlace.value.item);
      pendingPlace.value = null;
      return true;
    }

    // Pair mode
    if (!placedFirst.value) {
      store.placeItem({ row, col }, pendingPlace.value.items[0]);
      placedFirst.value = { row, col };
      return true;
    }

    // Place second item adjacent to first
    const dr = Math.abs(row - placedFirst.value.row);
    const dc = Math.abs(col - placedFirst.value.col);
    if ((dr === 1 && dc === 0) || (dr === 0 && dc === 1)) {
      store.placeItem({ row, col }, pendingPlace.value.items[1]);
      pendingPlace.value = null;
      placedFirst.value = null;
      return true;
    }
    // Not adjacent — restart: place first here instead
    store.placeItem({ row, col }, pendingPlace.value.items[0]);
    placedFirst.value = { row, col };
    return true;
  },
  get isPlacing() {
    return pendingPlace.value !== null;
  },
});
</script>

<template>
  <div class="debug-panel">
    <div class="debug-header" @click="toggle">
      <span class="debug-title">DEBUG</span>
      <span class="debug-toggle">{{ collapsed ? '&#x25B6;' : '&#x25BC;' }}</span>
    </div>

    <div v-if="!collapsed && pendingPlace" class="place-status">
      <template v-if="pendingPlace.type === 'single'">
        Tap a cell to place
      </template>
      <template v-else>
        <template v-if="!placedFirst">Tap cell for 1st item</template>
        <template v-else>Tap adjacent cell for 2nd</template>
      </template>
      <button class="cancel-btn" @click="cancel">Cancel</button>
    </div>

    <div v-else-if="!collapsed" class="debug-sections">
      <div class="section">
        <div class="section-label">Single</div>
        <div class="btn-row">
          <button
            v-for="item in items"
            :key="item"
            class="debug-btn"
            @click="selectSingle(item)"
          >
            <ItemIcon :item="item" :size="20" />
          </button>
        </div>
      </div>
      <div class="section">
        <div class="section-label">Pair</div>
        <div class="btn-row pair-row">
          <button
            v-for="pair in pairs"
            :key="pair.label"
            class="debug-btn pair-btn"
            @click="selectPair(pair.items)"
          >
            <span class="pair-icons">
              <ItemIcon :item="pair.items[0]" :size="14" />
              <span class="pair-plus">+</span>
              <ItemIcon :item="pair.items[1]" :size="14" />
            </span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.debug-panel {
  background: #1a1a2e;
  border-radius: 8px;
  padding: 8px 10px;
  color: #ccc;
  font-size: 11px;
}
.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  user-select: none;
}
.debug-title {
  font-size: 10px;
  font-weight: 700;
  color: #f0c040;
  letter-spacing: 1px;
}
.debug-toggle {
  font-size: 10px;
  color: #888;
}
.debug-sections {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.section-label {
  font-size: 9px;
  color: #888;
  text-transform: uppercase;
  margin-bottom: 3px;
}
.btn-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.debug-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px 10px;
  border: 1px solid #333;
  border-radius: 4px;
  background: #2a2a3e;
  cursor: pointer;
  color: #ccc;
  font-size: 10px;
}
.debug-btn:active {
  background: #3a3a5e;
}
.pair-btn {
  padding: 4px 8px;
}
.pair-icons {
  display: flex;
  align-items: center;
  gap: 2px;
}
.pair-plus {
  font-size: 10px;
  color: #666;
}
.place-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #f0c040;
  padding: 4px 0;
}
.cancel-btn {
  border: 1px solid #666;
  background: #333;
  color: #ccc;
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 10px;
  cursor: pointer;
}
</style>
