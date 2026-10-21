// Push notification handler (imported by Workbox-generated service worker)

// The slideshow tutorial's screenshots were cached at runtime under this name (#108 removed them).
// Workbox doesn't delete a runtime cache that left the config, so drop it here
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('tutorial-images'));
});

self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? { title: 'Vege-Table', body: 'New puzzle!' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon ?? '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      data: { url: data.url ?? '/' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus existing window if open
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Otherwise open a new window
      return self.clients.openWindow(url);
    }),
  );
});
