import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Toaster } from 'sonner'
import { Repos } from './pages/Repos'
import { RepoDetail } from './pages/RepoDetail'
import { SessionDetail } from './pages/SessionDetail'
import { SettingsDialog } from './components/settings/SettingsDialog'
import { useSettingsDialog } from './hooks/useSettingsDialog'
import { useTheme } from './hooks/useTheme'
import { usePWA } from './hooks/usePWA'
import { TTSProvider } from './contexts/TTSContext'
import { EventProvider, usePermissions } from '@/contexts/EventContext'
import { PermissionRequestDialog } from './components/session/PermissionRequestDialog'
import { NotificationPermissionPrompt } from './components/notifications/NotificationPermissionPrompt'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 10,
      refetchOnWindowFocus: true,
    },
  },
})

function RouterContent() {
  const { isOpen, close } = useSettingsDialog()
  const [showNotificationPrompt, setShowNotificationPrompt] = useState(false)
  useTheme()
  usePWA()

  useEffect(() => {
    const hasSeenPrompt = localStorage.getItem('notification-prompt-seen')
    if (!hasSeenPrompt) {
      const timer = setTimeout(() => {
        setShowNotificationPrompt(true)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleCloseNotificationPrompt = () => {
    setShowNotificationPrompt(false)
    localStorage.setItem('notification-prompt-seen', 'true')
  }

  useEffect(() => {
    const loader = document.getElementById('app-loader')
    if (loader) {
      loader.style.transition = 'opacity 0.2s ease-out'
      loader.style.opacity = '0'
      setTimeout(() => loader.remove(), 200)
    }
  }, [])

  return (
    <>
      <Routes>
        <Route path="/" element={<Repos />} />
        <Route path="/repos/:id" element={<RepoDetail />} />
        <Route path="/repos/:id/sessions/:sessionId" element={<SessionDetail />} />
      </Routes>
      <SettingsDialog open={isOpen} onOpenChange={close} />
      <Toaster
        position="bottom-right"
        expand={false}
        richColors
        closeButton
        duration={2500}
      />
      {showNotificationPrompt && (
        <NotificationPermissionPrompt onClose={handleCloseNotificationPrompt} />
      )}
    </>
  )
}

function PermissionDialogWrapper() {
  const {
    current: currentPermission,
    pendingCount,
    respond: respondToPermission,
    showDialog,
    setShowDialog,
  } = usePermissions()

  return (
    <PermissionRequestDialog
      permission={currentPermission}
      pendingCount={pendingCount}
      isFromDifferentSession={false}
      onRespond={respondToPermission}
      open={showDialog}
      onOpenChange={setShowDialog}
      repoDirectory={null}
    />
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TTSProvider>
        <BrowserRouter>
          <EventProvider>
            <RouterContent />
            <PermissionDialogWrapper />
          </EventProvider>
        </BrowserRouter>
      </TTSProvider>
    </QueryClientProvider>
  )
}

export default App
