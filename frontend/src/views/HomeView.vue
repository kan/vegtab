<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { generateTransferCode, redeemTransferCode, showToast, api } from '@/api/client';
import { setLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { useSound } from '@/sound';
import { useCalendar } from '@/composables/useCalendar';
import { todayJST, nextMidnightJST } from '@/utils/date';
import RankingModal from '@/components/RankingModal.vue';
import VegetableIcon from '@/components/VegetableIcon.vue';

const { t, locale } = useI18n();
const router = useRouter();
const gameStore = useGameStore();
const { isDark, toggle: doToggleTheme } = useTheme();
const { seEnabled, bgmEnabled, vibrationEnabled, soundPromptNeeded, acceptSound, declineSound, toggleSE, toggleBGM, toggleVibration } = useSound();

// Title vegetable icons (random pair, different left/right)
const titleVegeLeft = Math.floor(Math.random() * 5) as 0 | 1 | 2 | 3 | 4;
const titleVegeRight = ((titleVegeLeft + 1 + Math.floor(Math.random() * 4)) % 5) as 0 | 1 | 2 | 3 | 4;

// Hamburger menu
const menuOpen = ref(false);

// Ranking modal
const rankingSeed = ref(0);
const showRanking = ref(false);

// Share code input
const showShareCodeInput = ref(false);
const shareCodeInput = ref('');

function openShareCodeInput() {
  menuOpen.value = false;
  shareCodeInput.value = '';
  showShareCodeInput.value = true;
}

async function submitShareCode() {
  const code = shareCodeInput.value.trim().toUpperCase();
  if (!code) return;
  router.push(`/s/${code}`);
  showShareCodeInput.value = false;
}

// --- Account transfer ---
const showTransferMenu = ref(false);
const transferCode = ref('');
const transferLoading = ref(false);
const showRedeemInput = ref(false);
const redeemCodeInput = ref('');
const redeemLoading = ref(false);

function openTransferMenu() {
  menuOpen.value = false;
  transferCode.value = '';
  showTransferMenu.value = true;
}

async function copyTransferCode() {
  if (!transferCode.value) return;
  try {
    await navigator.clipboard.writeText(transferCode.value);
    showToast('success', 'common.copiedToClipboard');
  } catch {
    // Clipboard API not available
  }
}

async function doGenerateCode() {
  transferLoading.value = true;
  try {
    const result = await generateTransferCode();
    transferCode.value = result.code;
  } catch {
    showToast('error', 'transfer.failed');
    showTransferMenu.value = false;
  }
  transferLoading.value = false;
}

function openRedeemInput() {
  menuOpen.value = false;
  redeemCodeInput.value = '';
  showRedeemInput.value = true;
}

async function doRedeem() {
  const code = redeemCodeInput.value.trim().toUpperCase();
  if (!code) return;
  redeemLoading.value = true;
  try {
    const result = await redeemTransferCode(code);
    await gameStore.resetAfterTransfer(result.displayName);
    showRedeemInput.value = false;
    showToast('success', 'transfer.success');
  } catch {
    showToast('error', 'transfer.failed');
  }
  redeemLoading.value = false;
}

function openRanking(seed: number) {
  rankingSeed.value = seed;
  showRanking.value = true;
}

// Calendar
const cal = useCalendar();
const showCalendar = ref(false);

// --- Daily seed ---
const today = todayJST();
const todaySeed = computed(() => gameStore.generateDailySeed(today));
const todayBestSprint = computed(() => gameStore.getBestScore(todaySeed.value, 'sprint'));
const todayBestClear = computed(() => gameStore.getBestScore(todaySeed.value, 'clear'));
const todayBestSurvival = computed(() => gameStore.getBestMoves(todaySeed.value, 'survival'));

function playMode(mode: string) {
  router.push(`/puzzle/${todaySeed.value}?mode=${mode}`);
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

// --- User name ---
const editingName = ref(false);
const nameInput = ref(gameStore.displayName);

function saveName() {
  gameStore.setDisplayName(nameInput.value.trim());
  editingName.value = false;
}

// --- Daily help ---
const showDailyHelp = ref(false);

// --- Daily countdown (time until JST midnight) ---
const countdown = ref('');
let countdownTimer: ReturnType<typeof setInterval> | undefined;

function updateCountdown() {
  const now = new Date();
  const diff = nextMidnightJST() - now.getTime();
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  countdown.value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

onMounted(() => {
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
});

onUnmounted(() => {
  clearInterval(countdownTimer);
});

// --- Ranking preview (from API) ---
const rankingMode = ref<'sprint' | 'clear' | 'survival'>('sprint');
const rankingPreview = ref<Array<{ rank: number; playerName: string; score: number; moves: number }>>([]);
const rankingLoading = ref(false);

let previewSeq = 0;

async function fetchRankingPreview() {
  const seq = ++previewSeq;
  rankingLoading.value = true;
  try {
    const data = await api<{
      ranking: Array<{ rank: number; displayName: string; score: number; moveCount: number }>;
    }>(`/api/rankings/by-value/${todaySeed.value}?mode=${rankingMode.value}`);
    if (seq !== previewSeq) return;
    rankingPreview.value = data.ranking.slice(0, 5).map(e => ({
      rank: e.rank,
      playerName: e.displayName,
      score: e.score,
      moves: e.moveCount,
    }));
  } catch {
    if (seq !== previewSeq) return;
    rankingPreview.value = [];
  }
  rankingLoading.value = false;
}

watch(rankingMode, () => fetchRankingPreview());
onMounted(() => { fetchRankingPreview(); });

function rankingDisplayValue(entry: { score: number; moves: number }) {
  if (rankingMode.value === 'clear' || rankingMode.value === 'survival') {
    return `${entry.moves} ${t('mode.moves')}`;
  }
  return entry.score.toLocaleString();
}

function rankingSubValue(entry: { score: number; moves: number }): string | null {
  if (rankingMode.value === 'clear' || rankingMode.value === 'survival') {
    return entry.score.toLocaleString();
  }
  return null;
}
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
        <VegetableIcon :color="titleVegeLeft" :size="32" class="title-vege" />
        {{ t('common.appName') }}
        <VegetableIcon :color="titleVegeRight" :size="32" class="title-vege" />
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

    <!-- Daily Puzzle -->
    <div class="section">
      <div class="section-title-row">
        <h2 class="section-title">{{ t('home.dailyPuzzle') }}</h2>
        <button class="help-btn" @click="showDailyHelp = !showDailyHelp" title="?">?</button>
      </div>
      <div v-if="showDailyHelp" class="daily-help-box">{{ t('home.dailyHelp') }}</div>
      <div class="daily-card-v2">
        <div class="daily-header">
          <span class="daily-date">{{ todayJST() }}</span>
          <span class="daily-seed">{{ t('common.seed', { seed: todaySeed }) }}</span>
          <button class="btn-ranking-small" @click.stop="openRanking(todaySeed)" :title="t('common.ranking')">&#x1F3C6;</button>
        </div>
        <div class="daily-countdown">
          <span class="countdown-label">{{ t('home.nextPuzzleIn') }}</span>
          <span class="countdown-time">{{ countdown }}</span>
        </div>
        <div class="mode-buttons">
          <button class="mode-btn" @click="playMode('sprint')">
            <span class="mode-btn-icon">⚡</span>
            <span class="mode-btn-name">{{ t('mode.sprint') }}</span>
            <span v-if="todayBestSprint > 0" class="mode-btn-best">{{ todayBestSprint.toLocaleString() }}</span>
            <span v-else class="mode-btn-play">{{ t('common.play') }}</span>
          </button>
          <button class="mode-btn" @click="playMode('clear')">
            <span class="mode-btn-icon">🧱</span>
            <span class="mode-btn-name">{{ t('mode.clear') }}</span>
            <span v-if="todayBestClear > 0" class="mode-btn-best">{{ todayBestClear }}{{ t('mode.moves') }}</span>
            <span v-else class="mode-btn-play">{{ t('common.play') }}</span>
          </button>
          <button class="mode-btn" @click="playMode('survival')">
            <span class="mode-btn-icon">♾️</span>
            <span class="mode-btn-name">{{ t('mode.survival') }}</span>
            <span v-if="todayBestSurvival > 0" class="mode-btn-best">{{ todayBestSurvival }}{{ t('mode.moves') }}</span>
            <span v-else class="mode-btn-play">{{ t('common.play') }}</span>
          </button>
        </div>
        <!-- Ranking preview -->
        <div class="ranking-preview">
          <div class="ranking-preview-header">
            <span class="ranking-preview-title">🏆 {{ t('home.rankingPreview') }}</span>
            <button class="ranking-see-all" @click="openRanking(todaySeed)">{{ t('home.seeAll') }}</button>
          </div>
          <div class="ranking-mode-tabs">
            <button :class="['ranking-mode-tab', { active: rankingMode === 'sprint' }]" @click="rankingMode = 'sprint'">{{ t('mode.sprint') }}</button>
            <button :class="['ranking-mode-tab', { active: rankingMode === 'clear' }]" @click="rankingMode = 'clear'">{{ t('mode.clear') }}</button>
            <button :class="['ranking-mode-tab', { active: rankingMode === 'survival' }]" @click="rankingMode = 'survival'">{{ t('mode.survival') }}</button>
          </div>
          <template v-if="rankingLoading">
            <div v-for="i in 3" :key="i" class="ranking-preview-row skeleton-row">
              <span class="ranking-preview-rank skeleton-block skeleton-rank" />
              <span class="skeleton-block skeleton-name" />
              <span class="skeleton-block skeleton-val" />
            </div>
          </template>
          <template v-else-if="rankingPreview.length > 0">
            <div v-for="entry in rankingPreview" :key="entry.rank" class="ranking-preview-row">
              <span class="ranking-preview-rank">{{ entry.rank }}</span>
              <span class="ranking-preview-name">{{ entry.playerName }}</span>
              <span class="ranking-preview-score">{{ rankingDisplayValue(entry) }}</span>
              <span v-if="rankingSubValue(entry)" class="ranking-preview-sub">{{ rankingSubValue(entry) }}</span>
            </div>
          </template>
          <div v-else class="ranking-preview-empty">{{ t('common.noRecords') }}</div>
        </div>
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
              <span v-else-if="!isFuture(cell.date) && gameStore.hasPlayedDaily(cell.date)" class="cal-played-dot" />
            </template>
          </div>
        </div>
      </div>
    </div>

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
            <div class="menu-divider" />
            <button class="menu-item" @click="openTransferMenu">
              <span class="menu-item-icon">📲</span>
              <span class="menu-item-label">{{ t('transfer.generate') }}</span>
            </button>
            <button class="menu-item" @click="openRedeemInput">
              <span class="menu-item-icon">🔑</span>
              <span class="menu-item-label">{{ t('transfer.redeem') }}</span>
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

    <!-- Transfer code generate modal -->
    <Teleport to="body">
      <div v-if="showTransferMenu" class="modal-overlay" @click.self="showTransferMenu = false">
        <div class="modal">
          <h3 class="modal-title">{{ t('transfer.title') }}</h3>
          <p class="modal-desc">{{ t('transfer.generateDesc') }}</p>
          <template v-if="transferCode">
            <p class="transfer-code-label">{{ t('transfer.codeLabel') }}</p>
            <div class="transfer-code-display" @click="copyTransferCode">{{ transferCode }}</div>
            <p class="transfer-code-expiry">{{ t('transfer.codeExpiry', { minutes: 10 }) }}</p>
          </template>
          <div class="modal-actions">
            <button v-if="!transferCode" class="modal-btn-primary" :disabled="transferLoading" @click="doGenerateCode">
              {{ t('transfer.generate') }}
            </button>
            <button class="modal-btn-secondary" @click="showTransferMenu = false">{{ t('common.ok') }}</button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Transfer code redeem modal -->
    <Teleport to="body">
      <div v-if="showRedeemInput" class="modal-overlay" @click.self="showRedeemInput = false">
        <div class="modal">
          <h3 class="modal-title">{{ t('transfer.redeem') }}</h3>
          <p class="modal-desc">{{ t('transfer.redeemDesc') }}</p>
          <p class="transfer-warning">{{ t('transfer.warning') }}</p>
          <input
            v-model="redeemCodeInput"
            class="share-code-input"
            maxlength="10"
            :placeholder="t('transfer.codePlaceholder')"
            @keyup.enter="doRedeem"
          />
          <div class="modal-actions">
            <button class="modal-btn-primary" :disabled="!redeemCodeInput.trim() || redeemLoading" @click="doRedeem">
              {{ t('transfer.confirm') }}
            </button>
            <button class="modal-btn-secondary" @click="showRedeemInput = false">{{ t('common.cancel') }}</button>
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
  bottom: 80px;
  right: max(16px, calc((100vw - 480px) / 2 + 16px));
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
  color: var(--title-color);
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

/* Daily card v2 */
.daily-card-v2 {
  background: var(--bg-card);
  border-radius: 10px;
  padding: 16px;
  box-shadow: var(--shadow-card);
}
.daily-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}
.daily-date {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.daily-seed {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
}
.daily-countdown {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 12px;
}
.countdown-label {
  color: var(--text-muted);
}
.countdown-time {
  font-family: monospace;
  font-weight: 700;
  color: var(--text-secondary);
  letter-spacing: 0.05em;
}
.mode-buttons {
  display: flex;
  gap: 8px;
}
.mode-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 10px 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card-alt);
  cursor: pointer;
  transition: border-color 0.15s, transform 0.1s;
}
.mode-btn:hover {
  border-color: var(--brand);
}
.mode-btn:active {
  transform: scale(0.96);
}
.mode-btn-icon {
  font-size: 20px;
}
.mode-btn-name {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
  text-transform: uppercase;
}
.mode-btn-best {
  font-size: 11px;
  font-weight: 600;
  color: var(--brand);
}
.mode-btn-play {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
}

/* Section title row with help */
.section-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.help-btn {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--text-muted);
  background: none;
  color: var(--text-muted);
  font-size: 11px;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.daily-help-box {
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

/* Ranking preview */
.ranking-preview {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.ranking-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.ranking-preview-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-secondary);
}
.ranking-see-all {
  background: none;
  border: none;
  font-size: 11px;
  color: var(--brand);
  font-weight: 600;
  cursor: pointer;
}
.ranking-preview-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
}
.ranking-preview-rank {
  width: 20px;
  text-align: center;
  font-weight: 700;
  color: var(--text-muted);
}
.ranking-preview-name {
  flex: 1;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ranking-preview-score {
  font-weight: 700;
  color: var(--brand);
}
.ranking-preview-sub {
  font-size: 10px;
  color: var(--text-muted);
  font-weight: 500;
}
.ranking-mode-tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 6px;
}
.ranking-mode-tab {
  flex: 1;
  padding: 4px 0;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: none;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-muted);
  cursor: pointer;
  text-transform: uppercase;
}
.ranking-mode-tab.active {
  background: var(--brand);
  color: #fff;
  border-color: var(--brand);
}
.ranking-preview-empty {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  padding: 8px 0;
}
/* Skeleton loading (animation in theme.css) */
.skeleton-row { pointer-events: none; }
.skeleton-block { display: inline-block; height: 12px; }
.skeleton-rank { width: 16px; }
.skeleton-name { flex: 1; }
.skeleton-val { width: 40px; }

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
.cal-played-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--brand);
  opacity: 0.5;
  position: absolute;
  bottom: 3px;
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
.transfer-code-label {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0 0 6px;
  font-weight: 600;
}
.transfer-code-display {
  font-family: monospace;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.15em;
  text-align: center;
  padding: 12px;
  background: var(--bg-card-alt);
  border: 2px dashed var(--brand);
  border-radius: 8px;
  color: var(--text-primary);
  margin-bottom: 8px;
  user-select: all;
  cursor: pointer;
  transition: background 0.15s;
}
.transfer-code-display:active {
  background: var(--bg-hover);
}
.transfer-code-expiry {
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
  margin: 0 0 12px;
}
.transfer-warning {
  font-size: 11px;
  color: var(--warning-text, #c05621);
  background: var(--warning-bg, #fefcbf);
  border-radius: 6px;
  padding: 8px 10px;
  margin: 0 0 12px;
}
</style>
