<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useGameStore } from '@/stores/game';
import { showToast } from '@/api/client';
import { issueTransferCode, redeemTransferCode, portalUrl } from '@/api/id';
import NameDialog from './NameDialog.vue';
import SettingsModal from './SettingsModal.vue';
import VegetableIcon from './VegetableIcon.vue';
import CloseButton from './CloseButton.vue';

/**
 * The menu, shared by HOME and the puzzle screen: the ≡ button in the screen's header and the
 * sheet it opens from the bottom, as TAKO-SEN's menu (#104). It holds what is used now and then;
 * the calendar and the achievements stay on their screens
 */
/**
 * account: false hides the transfer codes and the portal. The puzzle screen passes it, since
 * switching the ID mid-play would send the previous ID's game as the new ID's
 */
withDefaults(defineProps<{ account?: boolean }>(), { account: true });

const { t } = useI18n();
const router = useRouter();
const gameStore = useGameStore();

const open = ref(false);

function close() {
  open.value = false;
}

type Dialog = 'settings' | 'name' | 'shareCode' | 'transferIssue' | 'transferRedeem' | null;
const dialog = ref<Dialog>(null);

function openDialog(next: Exclude<Dialog, null>) {
  close();
  dialog.value = next;
  if (next === 'shareCode') shareCodeInput.value = '';
  if (next === 'transferIssue') transferCode.value = '';
  if (next === 'transferRedeem') redeemCodeInput.value = '';
}

function go(path: string) {
  close();
  router.push(path);
}

/** Recovery codes and withdrawal are on the kan-game.app portal, shared by its games */
function openAccountPortal() {
  close();
  window.open(portalUrl('/account'), '_blank', 'noopener');
}

// --- Share code ---
const shareCodeInput = ref('');

function submitShareCode() {
  const code = shareCodeInput.value.trim().toUpperCase();
  if (!code) return;
  dialog.value = null;
  router.push(`/s/${code}`);
}

// --- Transfer codes (kan-game.app ID) ---
const transferCode = ref('');
const transferLoading = ref(false);
const redeemCodeInput = ref('');
const redeemLoading = ref(false);

async function copyTransferCode() {
  if (!transferCode.value) return;
  try {
    await navigator.clipboard.writeText(transferCode.value);
    showToast('success', 'common.copiedToClipboard');
  } catch {
    // Clipboard API not available
  }
}

async function generateCode() {
  transferLoading.value = true;
  const result = await issueTransferCode();
  if (result.ok) {
    transferCode.value = result.code;
  } else {
    showToast('error', result.reason === 'offline' ? 'toast.networkError' : 'transfer.failed');
    dialog.value = null;
  }
  transferLoading.value = false;
}

async function redeem() {
  const code = redeemCodeInput.value.trim();
  if (!code) return;
  redeemLoading.value = true;
  // On success the stores switch to the new ID's records (onIdChange in stores/game.ts)
  const result = await redeemTransferCode(code);
  if (result.ok) {
    dialog.value = null;
    showToast('success', 'transfer.success');
  } else {
    showToast('error', result.reason === 'rate_limited' ? 'transfer.tooManyAttempts'
      : result.reason === 'offline' ? 'toast.networkError' : 'transfer.failed');
  }
  redeemLoading.value = false;
}
</script>

<template>
  <button class="icon-btn icon-btn-plain" :aria-label="t('menu.title')" @click="open = true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
  </button>

  <Teleport to="body">
    <div v-if="open" class="sheet-overlay" @click.self="close">
      <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="menu-title">
        <div class="modal-header">
          <h2 id="menu-title" class="modal-title menu-title">
            <VegetableIcon :color="1" :size="28" />
            {{ t('menu.title') }}
          </h2>
          <CloseButton @click="close" />
        </div>

        <button v-if="!gameStore.displayName" class="btn menu-name" @click="openDialog('name')">{{ t('name.set') }}</button>
        <p v-else class="menu-player">{{ gameStore.displayName }}</p>

        <nav class="menu-list">
          <button class="row-btn" @click="openDialog('settings')">{{ t('home.settingsTitle') }}</button>
          <button class="row-btn" @click="go('/tutorial')">{{ t('tutorial.howToPlay') }}</button>
          <button class="row-btn" @click="openDialog('shareCode')">{{ t('home.enterShareCode') }}</button>
        </nav>

        <h3 v-if="account" class="menu-group">{{ t('menu.account') }}</h3>
        <nav v-if="account" class="menu-list">
          <button class="row-btn" @click="openDialog('transferIssue')">{{ t('transfer.generate') }}</button>
          <button class="row-btn" @click="openDialog('transferRedeem')">{{ t('transfer.redeem') }}</button>
          <button class="row-btn" @click="openAccountPortal">{{ t('account.portal') }}</button>
        </nav>

        <nav class="menu-list">
          <button class="row-btn" @click="go('/about')">{{ t('home.about') }}</button>
        </nav>
      </section>
    </div>
  </Teleport>

  <SettingsModal :open="dialog === 'settings'" @close="dialog = null" />
  <NameDialog :open="dialog === 'name'" @close="dialog = null" />

  <Teleport to="body">
    <div v-if="dialog === 'shareCode'" class="modal-overlay" @click.self="dialog = null">
      <div class="modal">
        <h3 class="modal-title">{{ t('home.enterShareCode') }}</h3>
        <p class="modal-desc">{{ t('home.shareCodeDesc') }}</p>
        <input
          v-model="shareCodeInput"
          class="modal-input code-input"
          maxlength="10"
          :placeholder="t('home.shareCodePlaceholder')"
          @keyup.enter="submitShareCode"
        />
        <div class="modal-actions">
          <button class="modal-btn-primary" :disabled="!shareCodeInput.trim()" @click="submitShareCode">{{ t('common.ok') }}</button>
          <button class="modal-btn-secondary" @click="dialog = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>

    <div v-if="dialog === 'transferIssue'" class="modal-overlay" @click.self="dialog = null">
      <div class="modal">
        <h3 class="modal-title">{{ t('transfer.title') }}</h3>
        <p class="modal-desc">{{ t('transfer.generateDesc') }}</p>
        <template v-if="transferCode">
          <p class="transfer-code-label">{{ t('transfer.codeLabel') }}</p>
          <button class="transfer-code-display" @click="copyTransferCode">{{ transferCode }}</button>
          <p class="transfer-code-expiry">{{ t('transfer.codeExpiry', { minutes: 10 }) }}</p>
        </template>
        <div class="modal-actions">
          <button v-if="!transferCode" class="modal-btn-primary" :disabled="transferLoading" @click="generateCode">
            {{ t('transfer.generate') }}
          </button>
          <button class="modal-btn-secondary" @click="dialog = null">{{ t('common.ok') }}</button>
        </div>
      </div>
    </div>

    <div v-if="dialog === 'transferRedeem'" class="modal-overlay" @click.self="dialog = null">
      <div class="modal">
        <h3 class="modal-title">{{ t('transfer.redeem') }}</h3>
        <p class="modal-desc">{{ t('transfer.redeemDesc') }}</p>
        <p class="modal-warning">{{ t('transfer.warning') }}</p>
        <input
          v-model="redeemCodeInput"
          class="modal-input code-input"
          maxlength="20"
          :placeholder="t('transfer.codePlaceholder')"
          @keyup.enter="redeem"
        />
        <div class="modal-actions">
          <button class="modal-btn-primary" :disabled="!redeemCodeInput.trim() || redeemLoading" @click="redeem">
            {{ t('transfer.confirm') }}
          </button>
          <button class="modal-btn-secondary" @click="dialog = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.menu-title {
  display: flex;
  align-items: center;
  gap: 8px;
}
.menu-name {
  margin-bottom: 14px;
}
.menu-player {
  margin: 0 0 14px;
  font-weight: 800;
}
.menu-group {
  margin: 18px 0 8px;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-secondary);
}
.menu-list {
  display: grid;
  gap: 10px;
}
.menu-list + .menu-list {
  margin-top: 18px;
}
.code-input {
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.15em;
  text-transform: uppercase;
}
.transfer-code-label {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-secondary);
  margin: 0 0 6px;
}
.transfer-code-display {
  display: block;
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 28px;
  font-weight: 800;
  letter-spacing: 0.15em;
  text-align: center;
  padding: 12px;
  background: var(--bg-card-alt);
  border: 2px dashed var(--ink);
  border-radius: 12px;
  color: var(--ink);
  margin-bottom: 8px;
  user-select: all;
  cursor: pointer;
}
.transfer-code-expiry {
  font-size: 13px;
  color: var(--text-muted);
  text-align: center;
  margin: 0 0 12px;
}
</style>
