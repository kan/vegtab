<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { setLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { useSound } from '@/sound';
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
const { isDark, toggle: doToggleTheme } = useTheme();
const { seEnabled, bgmEnabled, vibrationEnabled, soundPromptNeeded, acceptSound, declineSound, toggleSE, toggleBGM, toggleVibration } = useSound();

// Hamburger menu
const menuOpen = ref(false);

// Ranking modal
const rankingSeed = ref(0);
const showRanking = ref(false);

// Share code input
const showShareCodeInput = ref(false);
const shareCodeInput = ref('');
const shareCodeError = ref(false);

function openShareCodeInput() {
  menuOpen.value = false;
  shareCodeInput.value = '';
  shareCodeError.value = false;
  showShareCodeInput.value = true;
}

async function submitShareCode() {
  const code = shareCodeInput.value.trim().toUpperCase();
  if (!code) return;
  shareCodeError.value = false;
  router.push(`/s/${code}`);
  showShareCodeInput.value = false;
}

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
    </div>

    <!-- Hero -->
    <div class="hero">
      <h1 class="app-title">
        <img src="/tomado-icon.svg" alt="" class="app-icon" />
        {{ t('common.appName') }}
      </h1>
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

    <!-- Hamburger menu button -->
    <button class="hamburger-btn" @click="menuOpen = !menuOpen" :title="t('home.settings')">
      <span class="hamburger-icon">&#x2630;</span>
    </button>

    <!-- Settings menu overlay -->
    <Teleport to="body">
      <div v-if="menuOpen" class="menu-overlay" @click.self="menuOpen = false">
        <div class="menu-panel">
          <div class="menu-header">
            <h3 class="menu-title">{{ t('home.settings') }}</h3>
            <button class="menu-close" @click="menuOpen = false">&times;</button>
          </div>
          <div class="menu-items">
            <button :class="['menu-item', { off: !seEnabled }]" @click="toggleSE">
              <span class="menu-item-icon">{{ seEnabled ? '🔊' : '🔇' }}</span>
              <span class="menu-item-label">{{ t('home.soundSE') }}</span>
              <span :class="['menu-item-status', { on: seEnabled }]">{{ seEnabled ? 'ON' : 'OFF' }}</span>
            </button>
            <button :class="['menu-item', { off: !bgmEnabled }]" @click="toggleBGM">
              <span class="menu-item-icon">🎵</span>
              <span class="menu-item-label">{{ t('home.soundBGM') }}</span>
              <span :class="['menu-item-status', { on: bgmEnabled }]">{{ bgmEnabled ? 'ON' : 'OFF' }}</span>
            </button>
            <button :class="['menu-item', { off: !vibrationEnabled }]" @click="toggleVibration">
              <span class="menu-item-icon">📳</span>
              <span class="menu-item-label">{{ t('home.soundVibration') }}</span>
              <span :class="['menu-item-status', { on: vibrationEnabled }]">{{ vibrationEnabled ? 'ON' : 'OFF' }}</span>
            </button>
            <div class="menu-divider" />
            <button class="menu-item" @click="openShareCodeInput">
              <span class="menu-item-icon">🔗</span>
              <span class="menu-item-label">{{ t('home.enterShareCode') }}</span>
            </button>
            <div class="menu-divider" />
            <button class="menu-item" @click="doToggleTheme">
              <span class="menu-item-icon">{{ isDark ? '☀️' : '🌙' }}</span>
              <span class="menu-item-label">{{ t('home.darkMode') }}</span>
              <span :class="['menu-item-status', { on: isDark }]">{{ isDark ? 'ON' : 'OFF' }}</span>
            </button>
            <button class="menu-item" @click="setLocale(locale === 'ja' ? 'en' : 'ja')">
              <span class="menu-item-icon">🌐</span>
              <span class="menu-item-label">{{ t('home.language') }}</span>
              <span class="menu-item-status on">{{ locale === 'ja' ? '日本語' : 'English' }}</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Sound prompt modal (first visit) -->
    <Teleport to="body">
      <div v-if="soundPromptNeeded" class="modal-overlay">
        <div class="modal">
          <h3 class="modal-title">{{ t('home.soundPromptTitle') }}</h3>
          <p class="modal-desc">{{ t('home.soundPromptMessage') }}</p>
          <div class="modal-actions">
            <button class="modal-btn-primary" @click="acceptSound()">{{ t('home.soundPromptYes') }}</button>
            <button class="modal-btn-secondary" @click="declineSound()">{{ t('home.soundPromptNo') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Share code input modal -->
    <Teleport to="body">
      <div v-if="showShareCodeInput" class="modal-overlay" @click.self="showShareCodeInput = false">
        <div class="modal">
          <h3 class="modal-title">{{ t('home.enterShareCode') }}</h3>
          <p class="modal-desc">{{ t('home.shareCodeDesc') }}</p>
          <input
            v-model="shareCodeInput"
            class="share-code-input"
            maxlength="10"
            :placeholder="t('home.shareCodePlaceholder')"
            @keyup.enter="submitShareCode"
          />
          <div class="modal-actions">
            <button class="modal-btn-primary" :disabled="!shareCodeInput.trim()" @click="submitShareCode">{{ t('common.ok') }}</button>
            <button class="modal-btn-secondary" @click="showShareCodeInput = false">{{ t('common.cancel') }}</button>
          </div>
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
  background: var(--alpha-bg);
  color: var(--alpha-text);
  border: 1px solid var(--alpha-border);
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
  background: var(--alpha-tag-bg);
  color: #fff;
  font-weight: 700;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
}
/* Hamburger menu */
.hamburger-btn {
  position: fixed;
  bottom: 70px;
  right: 16px;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 1px solid var(--border);
  background: var(--bg-card);
  box-shadow: var(--shadow-card);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.hamburger-icon {
  font-size: 20px;
  color: var(--text-secondary);
  line-height: 1;
}
.menu-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.menu-panel {
  background: var(--bg-card);
  border-radius: 16px 16px 0 0;
  width: 100%;
  max-width: 400px;
  padding: 16px 16px 32px;
  box-shadow: var(--shadow-modal);
}
.menu-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.menu-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.menu-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}
.menu-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: none;
  cursor: pointer;
  transition: background 0.15s;
}
.menu-item:hover {
  background: var(--bg-hover);
}
.menu-item.off {
  opacity: 0.6;
}
.menu-item-icon {
  font-size: 18px;
  width: 24px;
  text-align: center;
}
.menu-item-label {
  flex: 1;
  text-align: left;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}
.menu-item-status {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-disabled);
}
.menu-item-status.on {
  color: var(--brand);
}
.menu-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 12px;
}
.modal-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.modal-btn-primary {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}
.modal-btn-primary:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.modal-btn-secondary {
  padding: 12px;
  border: none;
  border-radius: 8px;
  background: none;
  color: var(--text-muted);
  font-weight: 600;
  font-size: 15px;
  cursor: pointer;
}
.share-code-input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-align: center;
  text-transform: uppercase;
  background: var(--bg-input);
  color: var(--text-primary);
  margin-bottom: 12px;
  box-sizing: border-box;
}

/* Hero */
.hero {
  text-align: center;
  padding: 20px 0 8px;
}
.app-title {
  font-size: 36px;
  color: var(--brand);
  font-weight: 800;
  letter-spacing: -1px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.app-icon {
  width: 40px;
  height: 40px;
}
.app-subtitle {
  font-size: 13px;
  color: var(--text-tertiary);
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
  color: var(--text-secondary);
  font-weight: 600;
  cursor: pointer;
}
.name-edit-icon {
  font-size: 12px;
  color: var(--text-muted);
  margin-left: 2px;
}
.name-input {
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 14px;
  width: 160px;
  text-align: center;
  background: var(--bg-input);
  color: var(--text-primary);
}
.name-save-btn {
  padding: 6px 12px;
  border: none;
  border-radius: 6px;
  background: var(--brand);
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
  background: var(--bg-card);
  border-radius: 10px;
  padding: 12px 8px;
  text-align: center;
  box-shadow: var(--shadow-card);
}
.stat-value {
  display: block;
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
}
.stat-label {
  font-size: 10px;
  color: var(--text-muted);
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
  border: 2px solid var(--brand);
  background: transparent;
  transition: background 0.2s;
}
.stamina-dot.filled {
  background: var(--brand);
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
  background: var(--bg-card);
  border-radius: 8px;
  padding: 6px 10px;
  box-shadow: var(--shadow-card);
}
.item-stock-count {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}
.undo-icon {
  font-size: 16px;
  color: var(--brand);
  font-weight: 700;
  line-height: 1;
}

/* Item reward */
.item-reward-banner {
  background: linear-gradient(135deg, var(--warning), var(--warning-deep));
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
  color: var(--text-secondary);
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
  color: var(--text-muted);
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
  background: var(--bg-card);
  border-radius: 10px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-card);
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
  color: var(--text-primary);
}
.daily-seed {
  font-size: 11px;
  color: var(--text-muted);
}
.daily-score {
  font-size: 16px;
  font-weight: 700;
  color: var(--brand);
}
.daily-play {
  background: var(--brand);
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
  background: var(--bg-card);
  color: var(--text-primary);
  box-shadow: var(--shadow-card);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-generate {
  background: var(--slate);
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
  background: var(--bg-card);
  border-radius: 10px;
  padding: 12px;
  box-shadow: var(--shadow-card);
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
  color: var(--text-secondary);
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
  color: var(--text-primary);
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
  color: var(--text-muted);
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
  background: var(--cal-today);
  font-weight: 700;
}
.cal-cell.played {
  background: var(--cal-played);
}
.cal-cell:not(.empty):not(.future):hover {
  background: var(--bg-hover);
}
.cal-day {
  font-size: 13px;
  color: var(--text-primary);
}
.cal-score {
  font-size: 7px;
  color: var(--brand);
  font-weight: 600;
  position: absolute;
  bottom: 1px;
}
.cal-check {
  font-size: 9px;
  color: var(--check-color);
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
  background: var(--bg-card);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  box-shadow: var(--shadow-card);
}
.seed-row-info {
  flex: 1;
  cursor: pointer;
}
.seed-row-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
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
  color: var(--brand);
}
.seed-score.free {
  color: var(--text-tertiary);
}
.seed-unplayed {
  font-size: 12px;
  color: var(--text-disabled);
}

/* Modal */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--bg-card);
  border-radius: 16px;
  padding: 24px;
  width: 320px;
  max-width: 90vw;
}
.modal-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0 0 4px;
}
.modal-desc {
  font-size: 12px;
  color: var(--text-muted);
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
  background: var(--bg-card-alt);
  border: 1px solid var(--border-alt);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.item-choice:hover {
  background: var(--bg-hover);
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
  color: var(--text-primary);
}
.item-desc {
  font-size: 11px;
  color: var(--text-muted);
}
.item-stock {
  font-size: 12px;
  color: var(--text-muted);
}
.btn-cancel {
  width: 100%;
  text-align: center;
  color: var(--text-muted);
  background: none;
  box-shadow: none;
}
</style>
