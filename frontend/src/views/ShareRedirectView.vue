<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/client';
import { useGameStore } from '@/stores/game';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const gameStore = useGameStore();
const error = ref(false);

onMounted(async () => {
  const code = (route.params.code as string).toUpperCase();
  try {
    // Ensure authenticated
    await gameStore.init();
    // Resolve share code → seed info
    const res = await api<{
      seedId: string;
      seedValue: string;
      shareCode: string;
    }>(`/api/seeds/by-code/${code}`);
    // Cache the mapping (persist to localStorage)
    const n = Number(res.seedValue);
    if (!Number.isNaN(n)) {
      gameStore.cacheShareCode(n, res.seedId, res.shareCode);
    }
    // Navigate to puzzle with the seed value
    router.replace(`/puzzle/${res.seedValue}`);
  } catch {
    error.value = true;
  }
});
</script>

<template>
  <div class="share-redirect">
    <div v-if="error" class="share-error">
      <h2>{{ t('shareRedirect.notFound') }}</h2>
      <p>{{ t('shareRedirect.notFoundMessage') }}</p>
      <button class="btn" @click="router.push('/')">{{ t('shareRedirect.goHome') }}</button>
    </div>
    <div v-else class="share-loading">
      <p>{{ t('shareRedirect.loading') }}</p>
    </div>
  </div>
</template>

<style scoped>
.share-redirect {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100dvh;
  background: var(--bg-page);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}
.share-error, .share-loading {
  text-align: center;
  padding: 32px;
}
.share-error h2 {
  color: var(--brand);
  margin-bottom: 8px;
}
.share-error p {
  color: var(--text-secondary);
  margin-bottom: 16px;
}
.btn {
  padding: 8px 24px;
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}
.share-loading p {
  color: var(--text-muted);
}
</style>
