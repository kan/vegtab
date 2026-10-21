<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { onToast, type ToastEvent } from '@/api/client';
import { crossIcon, checkIcon, infoIcon } from '@/assets/icons';

const { t } = useI18n();

interface Toast {
  id: number;
  type: ToastEvent['type'];
  messageKey: string;
  params?: Record<string, string>;
  leaving: boolean;
}

const toasts = ref<Toast[]>([]);
let nextId = 0;
let unsubscribe: (() => void) | undefined;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

onMounted(() => {
  unsubscribe = onToast((event) => {
    const id = nextId++;
    toasts.value.push({ id, type: event.type, messageKey: event.messageKey, params: event.params, leaving: false });
    const duration = event.duration ?? 4000;
    timers.set(id, setTimeout(() => dismissToast(id), duration));
  });
});

onUnmounted(() => {
  unsubscribe?.();
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
});

function dismissToast(id: number) {
  const toast = toasts.value.find(t => t.id === id);
  if (!toast || toast.leaving) return;
  const existing = timers.get(id);
  if (existing) { clearTimeout(existing); timers.delete(id); }
  toast.leaving = true;
  const removeTimer = setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id);
    timers.delete(id);
  }, 300);
  timers.set(id, removeTimer);
}
</script>

<template>
  <div class="toast-container">
    <div
      v-for="toast in toasts"
      :key="toast.id"
      :class="['toast', `toast-${toast.type}`, { 'toast-leaving': toast.leaving }]"
      @click="dismissToast(toast.id)"
    >
      <img class="toast-icon" :src="toast.type === 'error' ? crossIcon : toast.type === 'success' ? checkIcon : infoIcon" alt="" />
      <span class="toast-message">{{ t(toast.messageKey, toast.params ?? {}) }}</span>
    </div>
  </div>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: 72px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  display: flex;
  flex-direction: column-reverse;
  gap: 8px;
  width: min(360px, 90vw);
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px 10px 12px;
  border: var(--frame-thin);
  border-left-width: 8px;
  border-radius: 14px;
  background: var(--bg-card);
  font-size: 14px;
  font-weight: 800;
  color: var(--ink);
  pointer-events: auto;
  cursor: pointer;
  animation: toast-in 0.3s ease-out;
}
.toast-leaving {
  animation: toast-out 0.3s ease-in forwards;
}
/* The kind shows in the thick left edge and the icon, on the same light surface */
.toast-error { border-left-color: var(--danger); }
.toast-success { border-left-color: var(--brand); }
.toast-info { border-left-color: var(--info); }
.toast-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.toast-message {
  flex: 1;
}
@keyframes toast-in {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes toast-out {
  from { opacity: 1; transform: translateY(0); }
  to { opacity: 0; transform: translateY(20px); }
}
</style>
