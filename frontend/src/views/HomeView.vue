<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { setLocale } from '@/i18n';
import type { ItemType } from '@tomado/engine';
import { useTodoStore } from '@/stores/todo';
import { useCalendar } from '@/composables/useCalendar';
import { todayLocal } from '@/utils/date';
import { ALL_ITEM_TYPES, ITEM_INFO } from '@/utils/constants';
import ItemIcon from '@/components/ItemIcon.vue';
import RankingModal from '@/components/RankingModal.vue';

const { t, locale } = useI18n();
const router = useRouter();
const gameStore = useGameStore();
const todoStore = useTodoStore();

// Ranking modal
const rankingSeed = ref(0);
const showRanking = ref(false);

function openRanking(seed: number) {
  rankingSeed.value = seed;
  showRanking.value = true;
}

// Calendar
const cal = useCalendar();
const showCalendar = ref(false);

// Item selection modal
const showItemModal = ref(false);

// Stamina tick
let staminaTimer: ReturnType<typeof setInterval>;
onMounted(() => {
  gameStore.tickStamina();
  staminaTimer = setInterval(() => gameStore.tickStamina(), 60_000);
});
onUnmounted(() => clearInterval(staminaTimer));

// --- Daily seed ---
const today = todayLocal();
const todaySeed = computed(() => gameStore.generateDailySeed(today));
const todayBestScore = computed(() => gameStore.getBestScore(todaySeed.value, 'limited'));

function playDaily() {
  router.push(`/puzzle/${todaySeed.value}`);
}

// --- New puzzle ---
function newPuzzle() {
  router.push('/puzzle');
}

// --- Calendar ---
function playCalendarSeed(dateStr: string, seed: number) {
  if (dateStr > today) return;
  router.push(`/puzzle/${seed}`);
}

function isToday(dateStr: string): boolean {
  return dateStr === today;
}

function isFuture(dateStr: string): boolean {
  return dateStr > today;
}

// --- Item selection ---


function pickItem(type: ItemType) {
  gameStore.selectItem(type);
  showItemModal.value = false;
}

// --- Item stock ---
const totalItems = computed(() =>
  ALL_ITEM_TYPES.reduce((sum, t) => sum + gameStore.items[t], 0)
);

// --- Generated seeds ---
const generatedSeeds = computed(() =>
  [...gameStore.unlockedSeeds]
    .sort((a, b) => b.unlockedAt - a.unlockedAt)
    .map(s => ({
      ...s,
      bestLimited: gameStore.getBestScore(s.seed, 'limited'),
      bestFree: gameStore.getBestScore(s.seed, 'free'),
    }))
);
const showSeeds = ref(false);

// --- User name ---
const editingName = ref(false);
const nameInput = ref(gameStore.displayName);

function saveName() {
  gameStore.setDisplayName(nameInput.value.trim());
  editingName.value = false;
}

// --- Stamina display ---
const staminaDots = computed(() => {
  const current = gameStore.currentStamina;
  return Array.from({ length: 5 }, (_, i) => i < current);
});
</script>

<template>
  <div class="home-view">
    <!-- Alpha banner -->
    <div class="alpha-banner">
      <span class="alpha-tag">{{ t('alpha.tag') }}</span>
      {{ t('alpha.message') }}
      <button class="lang-toggle" @click="setLocale(locale === 'ja' ? 'en' : 'ja')">
        {{ locale === 'ja' ? 'EN' : 'JA' }}
      </button>
    </div>

    <!-- Hero -->
    <div class="hero">
      <h1 class="app-title">{{ t('common.appName') }}</h1>
      <p class="app-subtitle">{{ t('home.subtitle') }}</p>
      <div class="user-name-row">
        <template v-if="editingName">
          <input
            v-model="nameInput"
            class="name-input"
            maxlength="20"
            :placeholder="t('home.namePlaceholder')"
            @keyup.enter="saveName"
          />
          <button class="name-save-btn" @click="saveName">{{ t('common.ok') }}</button>
        </template>
        <template v-else>
          <span class="user-name" @click="editingName = true; nameInput = gameStore.displayName">
            {{ gameStore.effectiveName }}
            <span class="name-edit-icon">&#x270E;</span>
          </span>
        </template>
      </div>
    </div>

    <!-- Stats row -->
    <div class="stats-row">
      <div class="stat-card stamina-card">
        <div class="stat-label">{{ t('home.stamina') }}</div>
        <div class="stamina-dots">
          <span
            v-for="(filled, i) in staminaDots"
            :key="i"
            :class="['stamina-dot', { filled }]"
          />
        </div>
      </div>
      <div class="stat-card" style="cursor: pointer" @click="router.push('/todo')">
        <span class="stat-value">{{ todoStore.dailyCompleted }}</span>
        <span class="stat-label">{{ t('home.todayTodo') }}</span>
      </div>
    </div>

    <!-- Item stock (includes undo) -->
    <div v-if="totalItems > 0 || gameStore.undoStock > 0" class="item-stock-row">
      <div v-if="gameStore.undoStock > 0" class="item-stock-chip">
        <span class="undo-icon">&#x21A9;</span>
        <span class="item-stock-count">{{ gameStore.undoStock }}</span>
      </div>
      <template v-for="type in ALL_ITEM_TYPES" :key="type">
        <div v-if="gameStore.items[type] > 0" class="item-stock-chip">
          <ItemIcon :item="type" :size="18" />
          <span class="item-stock-count">{{ gameStore.items[type] }}</span>
        </div>
      </template>
    </div>

    <!-- Item reward banner -->
    <button
      v-if="gameStore.canSelectItem"
      class="item-reward-banner"
      @click="showItemModal = true"
    >
      {{ t('home.itemRewardAvailable') }}
    </button>

    <!-- Daily Puzzle -->
    <div class="section">
      <h2 class="section-title">{{ t('home.dailyPuzzle') }}</h2>
      <div class="daily-card">
        <div class="daily-info" @click="playDaily">
          <span class="daily-date">{{ todayLocal() }}</span>
          <span class="daily-seed">{{ t('common.seed', { seed: todaySeed }) }}</span>
        </div>
        <div class="daily-right">
          <div class="daily-score" v-if="todayBestScore > 0" @click="playDaily">
            {{ t('home.best', { score: todayBestScore.toLocaleString() }) }}
          </div>
          <div class="daily-play" v-else @click="playDaily">{{ t('common.play') }}</div>
          <button class="btn-ranking-small" @click.stop="openRanking(todaySeed)" :title="t('common.ranking')">&#x1F3C6;</button>
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="section">
      <h2 class="section-title">{{ t('home.newPuzzle') }}</h2>
      <div class="actions">
        <button
          class="btn btn-generate"
          @click="newPuzzle"
        >
          {{ t('home.newPuzzle') }}
        </button>
      </div>
    </div>

    <!-- Calendar -->
    <div class="section">
      <button class="section-toggle" @click="showCalendar = !showCalendar">
        <h2 class="section-title">{{ t('home.pastDailySeeds') }}</h2>
        <span class="toggle-arrow">{{ showCalendar ? '\u25B2' : '\u25BC' }}</span>
      </button>
      <div v-if="showCalendar" class="calendar">
        <div class="calendar-header">
          <button class="cal-nav" @click="cal.prevMonth">&lt;</button>
          <span class="cal-month">{{ cal.monthLabel.value }}</span>
          <button class="cal-nav" :disabled="cal.isCurrentMonth.value" @click="cal.nextMonth">&gt;</button>
        </div>
        <div class="calendar-weekdays">
          <span v-for="d in ['sun','mon','tue','wed','thu','fri','sat']" :key="d" class="cal-weekday">{{ t(`weekdays.${d}`) }}</span>
        </div>
        <div class="calendar-grid">
          <div
            v-for="(cell, i) in cal.grid.value"
            :key="i"
            :class="[
              'cal-cell',
              {
                empty: !cell,
                today: cell && isToday(cell.date),
                future: cell && isFuture(cell.date),
                played: cell && !isFuture(cell.date) && gameStore.hasPlayedDaily(cell.date),
              },
            ]"
            @click="cell && !isFuture(cell.date) && playCalendarSeed(cell.date, cell.seed)"
          >
            <template v-if="cell">
              <span class="cal-day">{{ parseInt(cell.date.slice(8)) }}</span>
              <span v-if="!isFuture(cell.date) && cal.bestScore(cell.seed) > 0" class="cal-score">{{ cal.bestScore(cell.seed) }}</span>
              <span v-else-if="!isFuture(cell.date) && gameStore.hasPlayedDaily(cell.date)" class="cal-check">\u2713</span>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Generated Seeds -->
    <div v-if="generatedSeeds.length > 0" class="section">
      <button class="section-toggle" @click="showSeeds = !showSeeds">
        <h2 class="section-title">{{ t('home.mySeeds') }}</h2>
        <span class="toggle-arrow">{{ showSeeds ? '\u25B2' : '\u25BC' }}</span>
      </button>
      <div v-if="showSeeds" class="seed-list">
        <div
          v-for="s in generatedSeeds"
          :key="s.seed"
          class="seed-row"
        >
          <div class="seed-row-info" @click="router.push(`/puzzle/${s.seed}`)">
            <span class="seed-row-value">{{ t('common.seed', { seed: s.seed }) }}</span>
          </div>
          <div class="seed-row-scores">
            <span v-if="s.bestLimited > 0" class="seed-score limited" @click="router.push(`/puzzle/${s.seed}`)">{{ s.bestLimited.toLocaleString() }}</span>
            <span v-if="s.bestFree > 0" class="seed-score free" @click="router.push(`/puzzle/${s.seed}`)">{{ t('home.freeScore', { score: s.bestFree.toLocaleString() }) }}</span>
            <span v-if="s.bestLimited === 0 && s.bestFree === 0" class="seed-unplayed" @click="router.push(`/puzzle/${s.seed}`)">{{ t('home.unplayed') }}</span>
            <button class="btn-ranking-small" @click.stop="openRanking(s.seed)" :title="t('common.ranking')">&#x1F3C6;</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Item Selection Modal -->
    <Teleport to="body">
      <div v-if="showItemModal" class="modal-overlay" @click.self="showItemModal = false">
        <div class="modal">
          <h3 class="modal-title">{{ t('home.chooseItem') }}</h3>
          <p class="modal-desc">{{ t('home.todoDoneToday', { count: gameStore.dailyState.todoCompletedCount }) }}</p>
          <div class="item-choices">
            <button
              v-for="type in gameStore.availableItemChoices"
              :key="type"
              class="item-choice"
              @click="pickItem(type)"
            >
              <ItemIcon :item="type" :size="32" />
              <div class="item-info">
                <span class="item-name">{{ ITEM_INFO[type].label }}</span>
                <span class="item-desc">{{ ITEM_INFO[type].desc }}</span>
              </div>
              <span class="item-stock">x{{ gameStore.items[type] }}</span>
            </button>
          </div>
          <button class="btn btn-cancel" @click="showItemModal = false">{{ t('home.later') }}</button>
        </div>
      </div>
    </Teleport>

    <RankingModal :seed="rankingSeed" :open="showRanking" @close="showRanking = false" />
  </div>
</template>

<style scoped>
.home-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 16px;
  overflow-y: auto;
  gap: 16px;
}

/* Alpha banner */
.alpha-banner {
  background: #fff3cd;
  color: #856404;
  border: 1px solid #ffc107;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.alpha-tag {
  background: #ffc107;
  color: #fff;
  font-weight: 700;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
}
.lang-toggle {
  margin-left: auto;
  padding: 2px 8px;
  border: 1px solid #856404;
  border-radius: 4px;
  background: transparent;
  color: #856404;
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  flex-shrink: 0;
}

/* Hero */
.hero {
  text-align: center;
  padding: 20px 0 8px;
}
.app-title {
  font-size: 36px;
  color: #c0392b;
  font-weight: 800;
  letter-spacing: -1px;
}
.app-subtitle {
  font-size: 13px;
  color: #888;
  margin-top: 4px;
}
.user-name-row {
  margin-top: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
}
.user-name {
  font-size: 14px;
  color: #555;
  font-weight: 600;
  cursor: pointer;
}
.name-edit-icon {
  font-size: 12px;
  color: #999;
  margin-left: 2px;
}
.name-input {
  padding: 6px 10px;
  border: 1px solid #ddd;
  border-radius: 6px;
  font-size: 14px;
  width: 160px;
  text-align: center;
  background: #fff;
}
.name-save-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: #c0392b;
  color: #fff;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

/* Stats */
.stats-row {
  display: flex;
  gap: 8px;
}
.stat-card {
  flex: 1;
  background: #fff;
  border-radius: 10px;
  padding: 12px 8px;
  text-align: center;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: #333;
}
.stat-label {
  font-size: 10px;
  color: #999;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.stamina-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.stamina-dots {
  display: flex;
  gap: 4px;
}
.stamina-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid #c0392b;
  background: transparent;
  transition: background 0.2s;
}
.stamina-dot.filled {
  background: #c0392b;
}

/* Item stock row */
.item-stock-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.item-stock-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.item-stock-count {
  font-size: 14px;
  font-weight: 700;
  color: #333;
}
.undo-icon {
  font-size: 16px;
  color: #c0392b;
  font-weight: 700;
  line-height: 1;
}

/* Item reward */
.item-reward-banner {
  background: linear-gradient(135deg, #f39c12, #e67e22);
  color: #fff;
  border: none;
  border-radius: 10px;
  padding: 12px 16px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  text-align: center;
  animation: pulse 2s infinite;
}
@keyframes pulse {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.02); }
}

/* Sections */
.section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.section-title {
  font-size: 13px;
  color: #666;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
}
.section-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: none;
  border: none;
  cursor: pointer;
  padding: 0;
}
.toggle-arrow {
  font-size: 12px;
  color: #999;
}

/* Ranking button */
.btn-ranking-small {
  background: none;
  border: none;
  font-size: 16px;
  cursor: pointer;
  padding: 2px 4px;
  flex-shrink: 0;
}

/* Daily card */
.daily-card {
  background: #fff;
  border-radius: 10px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  transition: transform 0.1s;
}
.daily-card:active {
  transform: scale(0.98);
}
.daily-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  cursor: pointer;
  flex: 1;
}
.daily-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.daily-date {
  font-size: 14px;
  font-weight: 600;
  color: #333;
}
.daily-seed {
  font-size: 11px;
  color: #999;
}
.daily-score {
  font-size: 16px;
  font-weight: 700;
  color: #c0392b;
}
.daily-play {
  background: #c0392b;
  color: #fff;
  padding: 8px 20px;
  border-radius: 6px;
  font-weight: 700;
  font-size: 13px;
}

/* Actions */
.actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.btn {
  padding: 14px;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
  background: #fff;
  color: #333;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-generate {
  background: #2c3e50;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.btn-sub {
  font-size: 10px;
  font-weight: 400;
  opacity: 0.7;
}
.btn-small {
  padding: 10px 16px;
  font-size: 14px;
}
/* Calendar */
.calendar {
  background: #fff;
  border-radius: 10px;
  padding: 12px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.calendar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.cal-nav {
  background: none;
  border: none;
  font-size: 18px;
  color: #666;
  cursor: pointer;
  padding: 4px 8px;
}
.cal-nav:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}
.cal-month {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}
.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
  margin-bottom: 4px;
}
.cal-weekday {
  text-align: center;
  font-size: 10px;
  color: #999;
  font-weight: 600;
}
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}
.cal-cell {
  aspect-ratio: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  cursor: pointer;
  position: relative;
  font-size: 13px;
}
.cal-cell.empty {
  cursor: default;
}
.cal-cell.future {
  opacity: 0.3;
  cursor: not-allowed;
}
.cal-cell.today {
  background: #fce0e0;
  font-weight: 700;
}
.cal-cell.played {
  background: #ddf2dd;
}
.cal-cell:not(.empty):not(.future):hover {
  background: #f0ebe3;
}
.cal-day {
  font-size: 13px;
  color: #333;
}
.cal-score {
  font-size: 7px;
  color: #c0392b;
  font-weight: 600;
  position: absolute;
  bottom: 1px;
}
.cal-check {
  font-size: 9px;
  color: #5aad5e;
  position: absolute;
  bottom: 2px;
}

/* Seed list */
.seed-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.seed-row {
  background: #fff;
  border-radius: 8px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
}
.seed-row-info {
  flex: 1;
  cursor: pointer;
}
.seed-row-value {
  font-size: 13px;
  font-weight: 600;
  color: #333;
}
.seed-row-scores {
  display: flex;
  gap: 8px;
  align-items: center;
}
.seed-score {
  font-size: 13px;
  font-weight: 700;
}
.seed-score.limited {
  color: #c0392b;
}
.seed-score.free {
  color: #888;
}
.seed-unplayed {
  font-size: 12px;
  color: #bbb;
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: #fff;
  border-radius: 16px;
  padding: 24px;
  width: 320px;
  max-width: 90vw;
}
.modal-title {
  font-size: 18px;
  font-weight: 700;
  color: #333;
  margin: 0 0 4px;
}
.modal-desc {
  font-size: 12px;
  color: #999;
  margin: 0 0 16px;
}
.item-choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}
.item-choice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  background: #f8f5f0;
  border: 1px solid #e8e0d4;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.item-choice:hover {
  background: #f0ebe3;
}
.item-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.item-name {
  font-weight: 600;
  font-size: 14px;
  color: #333;
}
.item-desc {
  font-size: 11px;
  color: #999;
}
.item-stock {
  font-size: 12px;
  color: #999;
}
.btn-cancel {
  width: 100%;
  text-align: center;
  color: #999;
  background: none;
  box-shadow: none;
}
</style>
