import { useState, useEffect } from 'preact/hooks'

// The `beforeinstallprompt` event fires early in the app lifecycle —
// potentially before any component mounts. Register at module import
// time so the first prompt isn't lost; the hook's useEffect adds a
// second listener to catch prompts that fire after mount and to sync
// React state.
let deferredPrompt = null
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault()
    deferredPrompt = e
  })
}

// PWA install prompt wiring. Returns {canInstall, install}.
// canInstall flips true when the browser has offered an install prompt;
// install() shows it and clears the cached event after the user's choice.
export function usePwaInstall() {
  let [canInstall, setCanInstall] = useState(!!deferredPrompt)
  useEffect(() => {
    let onPrompt = (e) => {
      e.preventDefault()
      deferredPrompt = e
      setCanInstall(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])
  let install = async () => {
    if (!deferredPrompt) return
    deferredPrompt.prompt()
    await deferredPrompt.userChoice
    deferredPrompt = null
    setCanInstall(false)
  }
  return { canInstall, install }
}
