import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Bell, BellOff, X } from 'lucide-react'
import {
  notificationService,
  type NotificationPermissionStatus,
} from '@/lib/notifications'
import { showToast } from '@/lib/toast'

interface NotificationPermissionPromptProps {
  onClose?: () => void
}

export function NotificationPermissionPrompt({
  onClose,
}: NotificationPermissionPromptProps) {
  const [permission, setPermission] = useState<NotificationPermissionStatus>('default')
  const [isVisible, setIsVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    const checkPermission = async () => {
      const status = await notificationService.checkPermissionStatus()
      setPermission(status)
      setIsVisible(status === 'default')
    }

    checkPermission()
  }, [])

  const handleRequestPermission = async () => {
    if (!notificationService.isSupported()) {
      showToast.error('Notifications are not supported in this browser')
      return
    }

    setIsLoading(true)
    try {
      const result = await notificationService.requestPermission()
      setPermission(result)
      
      if (result === 'granted') {
        showToast.success('Notifications enabled! You will be notified when input is needed')
        await notificationService.showNotification({
          title: 'Notifications Enabled',
          body: 'You will receive notifications when the AI agent needs your input',
          tag: 'permission-granted',
        })
        setIsVisible(false)
      } else {
        showToast.error('Notification permission denied')
        setIsVisible(false)
      }
    } catch (error) {
      console.error('Error requesting notification permission:', error)
      showToast.error('Failed to request notification permission')
    } finally {
      setIsLoading(false)
    }
  }

  const handleDismiss = () => {
    setIsVisible(false)
    onClose?.()
  }

  if (!isVisible || permission !== 'default') {
    return null
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <Card className="w-full max-w-md m-4">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              <CardTitle>Enable Notifications</CardTitle>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDismiss}
              className="h-6 w-6 -mt-2 -mr-2"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <CardDescription>
            Get notified when the AI agent needs your input or completes a task
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Notifications will alert you when:
            </p>
            <ul className="text-sm text-muted-foreground list-disc list-inside space-y-1">
              <li>The agent needs permission to proceed</li>
              <li>The agent has a question for you</li>
              <li>A task is completed and waiting for next steps</li>
            </ul>
          </div>
          <p className="text-xs text-muted-foreground">
            You can change this setting later in your preferences.
          </p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleDismiss}
            className="flex-1"
          >
            <BellOff className="h-4 w-4 mr-2" />
            Not Now
          </Button>
          <Button
            onClick={handleRequestPermission}
            disabled={isLoading}
            className="flex-1"
          >
            <Bell className="h-4 w-4 mr-2" />
            {isLoading ? 'Requesting...' : 'Enable'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  )
}
