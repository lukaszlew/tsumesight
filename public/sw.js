const CACHE = 'tsumesight-__BUILD_TIME__'

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', e => {
  let url = new URL(e.request.url)
  let isNavigate = e.request.mode === 'navigate'
  let isAsset = url.pathname.includes('/assets/')

  if (isNavigate) {
    // Network-first for HTML — always get latest, offline fallback to cache
    e.respondWith(
      fetch(e.request)
        .then(res => {
          let clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
  } else if (isAsset) {
    // Cache-first for hashed assets — immutable filenames from Vite
    e.respondWith(
      caches.match(e.request).then(cached => {
        if (cached) return cached
        return fetch(e.request).then(res => {
          let clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
          return res
        })
      })
    )
  } else {
    // Network-first for everything else (sw.js, manifest, etc.)
    e.respondWith(
      fetch(e.request)
        .then(res => {
          let clone = res.clone()
          caches.open(CACHE).then(c => c.put(e.request, clone))
          return res
        })
        .catch(() => caches.match(e.request))
    )
  }
})
