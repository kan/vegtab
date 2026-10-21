<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { api } from '@/api/client';
import { useGameStore } from '@/stores/game';
import QrCode from '@/components/QrCode.vue';
import { buildShareUrl } from '@/utils/shareUrl';

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const gameStore = useGameStore();
const error = ref(false);
const seedInfo = ref<{ seedValue: string; shareCode: string } | null>(null);

const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
const shareUrl = computed(() => seedInfo.value ? buildShareUrl(seedInfo.value.shareCode) : '');

function goToPuzzle() {
  if (seedInfo.value) {
    router.replace(`/puzzle/${seedInfo.value.seedValue}`);
  }
}

onMounted(async () => {
  const code = (route.params.code as string).toUpperCase();
  try {
    const [, res] = await Promise.all([
      gameStore.init(),
      api<{ seedId: string; seedValue: string; shareCode: string }>(`/api/seeds/by-code/${encodeURIComponent(code)}`),
    ]);
    seedInfo.value = { seedValue: res.seedValue, shareCode: res.shareCode };

    // Mobile: redirect immediately
    if (isMobile) {
      router.replace(`/puzzle/${res.seedValue}`);
    }
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
      <button class="btn btn-primary" @click="router.push('/')">{{ t('shareRedirect.goHome') }}</button>
    </div>

    <!-- PC: show landing page with QR -->
    <div v-else-if="seedInfo && !isMobile" class="share-landing">
      <h1 class="landing-title">{{ t('common.appName') }}</h1>
      <p class="landing-subtitle">{{ t('home.subtitle') }}</p>
      <div class="landing-code">{{ seedInfo.shareCode }}</div>
      <div class="landing-qr">
        <QrCode :value="shareUrl" :size="180" />
      </div>
      <p class="landing-hint">{{ t('shareRedirect.scanToPlay') }}</p>
      <button class="btn btn-primary" @click="goToPuzzle">{{ t('shareRedirect.playInBrowser') }}</button>
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
.share-loading p {
  color: var(--text-muted);
}

/* PC landing */
.share-landing {
  text-align: center;
  padding: 40px 32px;
  max-width: 400px;
}
.landing-title {
  font-size: 32px;
  color: var(--brand);
  font-weight: 800;
  margin: 0 0 4px;
}
.landing-subtitle {
  font-size: 13px;
  color: var(--text-tertiary);
  margin: 0 0 24px;
}
.landing-code {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: 0.2em;
  color: var(--text-primary);
  margin-bottom: 20px;
}
.landing-qr {
  display: flex;
  justify-content: center;
  margin-bottom: 12px;
}
.landing-hint {
  font-size: 13px;
  color: var(--text-muted);
  margin: 0 0 20px;
}
</style>
