<script setup lang="ts">
import { ref } from 'vue';
import { usePuzzleStore } from '@/stores/puzzle';
import type { ItemType } from '@vegtab/engine';
import { ALL_ITEM_TYPES } from '@/utils/constants';
import ItemIcon from './ItemIcon.vue';

const store = usePuzzleStore();

const visible = ref(false);
const pendingItem = ref<ItemType | null>(null);

function show() {
  visible.value = true;
}

function hide() {
  visible.value = false;
  pendingItem.value = null;
}

function selectItem(item: ItemType) {
  pendingItem.value = item;
  visible.value = false;
}

function cancel() {
  pendingItem.value = null;
}

defineExpose({
  show,
  handleCellTap(row: number, col: number): boolean {
    if (!pendingItem.value) return false;
    store.placeItem({ row, col }, pendingItem.value);
    pendingItem.value = null;
    return true;
  },
  get isPlacing() {
    return pendingItem.value !== null;
  },
});
</script>

<template>
  <!-- Place status bar (shown on puzzle screen when placing) -->
  <div v-if="pendingItem" class="place-bar">
    <span class="place-label">Tap a cell to place</span>
    <ItemIcon :item="pendingItem" :size="18" />
    <button class="cancel-btn" @click="cancel">Cancel</button>
  </div>

  <!-- Modal overlay -->
  <Teleport to="body">
    <div v-if="visible" class="debug-overlay" @click.self="hide">
      <div class="debug-modal">
        <div class="debug-header">
          <span class="debug-title">DEBUG: Place Item</span>
          <button class="close-btn" @click="hide">&times;</button>
        </div>
        <div class="item-grid">
          <button
            v-for="item in ALL_ITEM_TYPES"
            :key="item"
            class="item-btn"
            @click="selectItem(item)"
          >
            <ItemIcon :item="item" :size="28" />
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.place-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: #1a1a2e;
  border-radius: 6px;
  margin-top: 8px;
}
.place-label {
  font-size: 12px;
  color: #f0c040;
  flex: 1;
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
.debug-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.debug-modal {
  background: #1a1a2e;
  border-radius: 12px;
  padding: 16px;
  min-width: 260px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
}
.debug-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}
.debug-title {
  font-size: 12px;
  font-weight: 700;
  color: #f0c040;
  letter-spacing: 0.5px;
}
.close-btn {
  border: none;
  background: none;
  color: #888;
  font-size: 20px;
  cursor: pointer;
  padding: 0 4px;
}
.item-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.item-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: 1px solid #333;
  border-radius: 8px;
  background: #2a2a3e;
  cursor: pointer;
}
.item-btn:active {
  background: #3a3a5e;
}
</style>
