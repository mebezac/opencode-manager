import { useRegisterSW } from 'virtual:pwa-register/react'
import { useEffect } from 'react'
import { notificationService } from '@/lib/notifications'

export function usePWA() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, registration) {
      console.log('Service Worker registered:', swUrl)
      if (registration) {
        notificationService.setServiceWorkerRegistration(registration)
      }
    },
    onRegisterError(error) {
      console.error('Service Worker registration error:', error)
    },
  })

  useEffect(() => {
    if (offlineReady) {
      console.log('App is ready to work offline')
    }
  }, [offlineReady])

  const closePrompt = () => {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  const updateApp = () => {
    updateServiceWorker(true)
  }

  return {
    offlineReady,
    needRefresh,
    closePrompt,
    updateApp,
  }
}
