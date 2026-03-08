import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import { i18n } from './i18n';
import App from './App.vue';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./views/HomeView.vue') },
    { path: '/todo', component: () => import('./views/TodoView.vue') },
    { path: '/puzzle', component: () => import('./views/PuzzleView.vue') },
    { path: '/puzzle/:seed', component: () => import('./views/PuzzleView.vue') },
    { path: '/s/:code', component: () => import('./views/ShareRedirectView.vue') },
  ],
});

const app = createApp(App);
app.use(createPinia());
app.use(i18n);
app.use(router);
app.mount('#app');
