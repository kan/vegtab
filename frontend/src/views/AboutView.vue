<script setup lang="ts">
import { useI18n } from 'vue-i18n';
import BottomNav from '@/components/BottomNav.vue';

const { t } = useI18n();
</script>

<template>
  <div class="about-page">
    <div class="about-content">
      <h1 class="about-title">Vege-Table</h1>

      <section class="about-section">
        <h2>{{ t('about.credits') }}</h2>
        <div class="credit-item">
          <span class="credit-label">{{ t('about.icons') }}</span>
          <a href="https://openmoji.org/" target="_blank" rel="noopener noreferrer">OpenMoji</a>
          <span class="credit-license">CC BY-SA 4.0</span>
        </div>
      </section>
    </div>
    <BottomNav />
  </div>
</template>

<style scoped>
.about-page {
  display: flex;
  flex-direction: column;
  min-height: 100dvh;
}
.about-content {
  flex: 1;
  max-width: 480px;
  margin: 0 auto;
  padding: 24px 16px;
  width: 100%;
}
.about-title {
  font-size: 24px;
  font-weight: 700;
  color: var(--brand);
  margin: 0 0 24px;
}
.about-section h2 {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 12px;
}
.credit-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  background: var(--bg-card-alt);
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-primary);
}
.credit-item a {
  color: var(--brand);
  text-decoration: none;
  font-weight: 600;
}
.credit-item a:hover {
  text-decoration: underline;
}
.credit-license {
  font-size: 11px;
  color: var(--text-muted);
  background: var(--bg-card);
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: auto;
}
</style>
