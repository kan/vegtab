import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n } from './i18n';
import { initTheme } from './theme';
import { initSound } from './sound';
import './theme.css';
import App from './App.vue';

initTheme();
initSound();

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/HomeView.vue') },
    { path: '/puzzle', component: () => import('./views/PuzzleView.vue') },
    { path: '/puzzle/:seed', component: () => import('./views/PuzzleView.vue') },
    { path: '/achievements', component: () => import('./views/AchievementView.vue') },
    { path: '/replay/:scoreId', component: () => import('./views/ReplayView.vue') },
    { path: '/s/:code', component: () => import('./views/ShareRedirectView.vue') },
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(router);
app.mount('#app');
