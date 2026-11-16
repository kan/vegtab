<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { setLocale } from '@/i18n';
import CloseButton from './CloseButton.vue';
import { useSound } from '@/sound';
import { useAnim } from '@/anim';
import { getVapidPublicKey, subscribePush, unsubscribePush, showToast } from '@/api/client';
import {
  speakerLoudIcon, speakerMutedIcon, musicNoteIcon, vibrationIcon,
  globeIcon, speedIcon,
} from '@/assets/icons';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const { t, locale } = useI18n();
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
    <div v-if="open" class="modal-overlay" @click.self="emit('close')">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <div class="modal-header">
          <h3 id="settings-title" class="modal-title">{{ t('home.settingsTitle') }}</h3>
          <CloseButton @click="emit('close')" />
        </div>
        <div class="settings-items">
          <button class="row-btn" @click="toggleSE">
            <img class="s-icon" :src="seEnabled ? speakerLoudIcon : speakerMutedIcon" alt="" />
            <span class="s-label">{{ t('home.soundSE') }}</span>
            <span :class="['s-status', { on: seEnabled }]">{{ seEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="row-btn" @click="toggleBGM">
            <img class="s-icon" :src="musicNoteIcon" alt="" />
            <span class="s-label">{{ t('home.soundBGM') }}</span>
            <span :class="['s-status', { on: bgmEnabled }]">{{ bgmEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="row-btn" @click="toggleVibration">
            <img class="s-icon" :src="vibrationIcon" alt="" />
            <span class="s-label">{{ t('home.soundVibration') }}</span>
            <span :class="['s-status', { on: vibrationEnabled }]">{{ vibrationEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button v-if="pushSupported" class="row-btn" @click="togglePush" :disabled="pushLoading">
            <span class="s-icon notif-icon">&#x1F514;</span>
            <span class="s-label">{{ t('home.notification') }}</span>
            <span :class="['s-status', { on: pushEnabled }]">{{ pushLoading ? '...' : pushEnabled ? 'ON' : 'OFF' }}</span>
          </button>
          <button class="row-btn" @click="cycleSpeed">
            <img class="s-icon" :src="speedIcon" alt="" />
            <span class="s-label">{{ t('home.animSpeed') }}</span>
            <span class="s-status on">{{ animSpeed }}x</span>
          </button>
          <button class="row-btn" @click="setLocale(locale === 'ja' ? 'en' : 'ja')">
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
.settings-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
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
  font-size: 16px;
  color: var(--ink);
}
/* ON is a green pill, OFF a plain one: the state reads by its words, not only its colour */
.s-status {
  min-width: 52px;
  padding: 2px 10px;
  border: var(--frame-thin);
  border-radius: 999px;
  font-size: 13px;
  font-weight: 800;
  text-align: center;
  color: var(--text-secondary);
  background: var(--bg-card);
}
.s-status.on {
  color: var(--on-brand);
  background: var(--brand);
}
</style>
