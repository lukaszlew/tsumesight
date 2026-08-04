// Self-destructing service worker for the retired /tsumesight/ scope.
// Old installs poll this URL for updates; this replacement deletes the
// dead app's caches (ONLY tsumesight-prefixed ones - the origin is
// shared with the live /baduk-sight/ app), unregisters itself, and
// reloads its windows so they land on the moved-notice page.
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    let keys = await caches.keys()
    await Promise.all(keys.filter(k => k.startsWith('tsumesight')).map(k => caches.delete(k)))
    await self.registration.unregister()
    for (let c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url)
  })())
})
