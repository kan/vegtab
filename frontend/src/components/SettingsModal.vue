<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale } from '@/i18n';
import { useTheme } from '@/theme';
import { useSound } from '@/sound';
import { useAnim } from '@/anim';
import { getVapidPublicKey, subscribePush, unsubscribePush, showToast } from '@/api/client';
import {
  speakerLoudIcon, speakerMutedIcon, musicNoteIcon, vibrationIcon,
  sunIcon, moonIcon, globeIcon, speedIcon,
} from '@/assets/icons';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();
const { isDark, toggle: doToggleTheme } = useTheme();
const { seEnabled, bgmEnabled, vibrationEnabled, toggleSE, toggleBGM, toggleVibration } = useSound();
const { animSpeed, cycleSpeed } = useAnim();

// --- Push Notification ---
const pushSupported = typeof window !== 'undefined'
  && 'serviceWorker' in navigator
  && 'PushManager' in window;

const pushEnabled = ref(false);
const pushLoading = ref(false);

onMounted(async () => {
  if (!pushSupported) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    pushEnabled.value = !!sub;
  } catch { /* ignore */ }
});

async function togglePush() {
  if (pushLoading.value) return;
  pushLoading.value = true;
  try {
    const reg = await navigator.serviceWorker.ready;
    if (pushEnabled.value) {
      // Unsubscribe
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await unsubscribePush(sub.endpoint);
        await sub.unsubscribe();
      }
      pushEnabled.value = false;
    } else {
      // Subscribe
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return;
      const vapidKey = await getVapidPublicKey();
      if (!vapidKey) {
        showToast('error', 'toast.pushFailed');
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await subscribePush(sub);
      pushEnabled.value = true;
    }
  } catch {
    showToast('error', 'toast.pushFailed');
  } finally {
    pushLoading.value = false;
  }
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr.buffer as ArrayBuffer;
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="settings-overlay" @click.self="emit('close')">
      <div class="settings-panel">
        <div class="settings-header">
          <h3 class="settings-title">{{ t('home.settingsTitle') }}</h3>
          <button class="settings-close" @click="emit('close')">&times;</button>
        </div>
        <div class="settings-items">
          <button :class="['s-item', { off: !seEnabled }]" @click="toggleSE">
            <img class="s-icon" :src="seEnabled ? speakerLoudIcon : speakerMutedIcon" alt="" />
            <span class="s-label">{{ t('home.soundSE') }}</span>
            <span :class="['s-status', { on: seEnabled }]">{{ seEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button :class="['s-item', { off: !bgmEnabled }]" @click="toggleBGM">
            <img class="s-icon" :src="musicNoteIcon" alt="" />
            <span class="s-label">{{ t('home.soundBGM') }}</span>
            <span :class="['s-status', { on: bgmEnabled }]">{{ bgmEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button :class="['s-item', { off: !vibrationEnabled }]" @click="toggleVibration">
            <img class="s-icon" :src="vibrationIcon" alt="" />
            <span class="s-label">{{ t('home.soundVibration') }}</span>
            <span :class="['s-status', { on: vibrationEnabled }]">{{ vibrationEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button v-if="pushSupported" :class="['s-item', { off: !pushEnabled }]" @click="togglePush" :disabled="pushLoading">
            <span class="s-icon notif-icon">&#x1F514;</span>
            <span class="s-label">{{ t('home.notification') }}</span>
            <span :class="['s-status', { on: pushEnabled }]">{{ pushLoading ? '...' : pushEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="s-item" @click="cycleSpeed">
            <img class="s-icon" :src="speedIcon" alt="" />
            <span class="s-label">{{ t('home.animSpeed') }}</span>
            <span class="s-status on">{{ animSpeed }}x</span>
          </button>
          <div class="s-divider" />
          <button class="s-item" @click="doToggleTheme">
            <img class="s-icon" :src="isDark ? sunIcon : moonIcon" alt="" />
            <span class="s-label">{{ t('home.darkMode') }}</span>
            <span :class="['s-status', { on: isDark }]">{{ isDark ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="s-item" @click="setLocale(locale === 'ja' ? 'en' : 'ja')">
            <img class="s-icon" :src="globeIcon" alt="" />
            <span class="s-label">{{ t('home.language') }}</span>
            <span class="s-status on">{{ locale === 'ja' ? '日本語' : 'English' }}</span>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay-bg);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.settings-panel {
  background: var(--bg-card);
  border-radius: 16px;
  width: 340px;
  max-width: 90vw;
  padding: 20px;
  box-shadow: var(--shadow-modal);
}
.settings-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.settings-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}
.settings-close {
  background: none;
  border: none;
  font-size: 24px;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0 4px;
}
.settings-items {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.s-item {
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
.s-item:hover {
  background: var(--bg-hover);
}
.s-item.off {
  opacity: 0.6;
}
.s-icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}
.notif-icon {
  font-size: 18px;
  text-align: center;
  line-height: 22px;
}
.s-label {
  flex: 1;
  text-align: left;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}
.s-status {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-disabled);
}
.s-status.on {
  color: var(--brand);
}
.s-divider {
  height: 1px;
  background: var(--border);
  margin: 4px 12px;
}
</style>
