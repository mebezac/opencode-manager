import { useRegisterSW } from 'virtual:pwa-register/react'
import { notificationService } from '@/lib/notifications'

export function usePWA() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl: string, registration: ServiceWorkerRegistration | undefined) {
      if (registration) {
        notificationService.setServiceWorkerRegistration(registration)
      }
    },
  })

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
