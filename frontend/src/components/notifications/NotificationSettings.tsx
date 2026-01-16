import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Bell, BellOff } from 'lucide-react'
import {
  notificationService,
  type NotificationPermissionStatus,
} from '@/lib/notifications'
import { subscribeToPushNotifications, unsubscribeFromPushNotifications, getPushSubscription } from '@/lib/push'
import { showToast } from '@/lib/toast'

export function NotificationSettings() {
  const [permission, setPermission] = useState<NotificationPermissionStatus>('default')
  const [isSupported, setIsSupported] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isPushSubscribed, setIsPushSubscribed] = useState(false)

  useEffect(() => {
    const checkSupport = notificationService.isSupported()
    setIsSupported(checkSupport)

    const checkPermission = async () => {
      const status = await notificationService.checkPermissionStatus()
      setPermission(status)
      
      const subscription = await getPushSubscription()
      setIsPushSubscribed(!!subscription)
    }

    checkPermission()
  }, [])

  const handleToggleNotifications = async () => {
    if (permission === 'granted' && isPushSubscribed) {
      setIsLoading(true)
      try {
        await unsubscribeFromPushNotifications()
        setIsPushSubscribed(false)
        showToast.success('Push notifications disabled')
      } catch (error) {
        console.error('Error unsubscribing:', error)
        showToast.error('Failed to unsubscribe from push notifications')
      } finally {
        setIsLoading(false)
      }
      return
    }

    if (permission === 'denied') {
      showToast.error('Notification permission denied. Please enable in browser settings')
      return
    }

    setIsLoading(true)
    try {
      const subscription = await subscribeToPushNotifications()
      const status = await notificationService.checkPermissionStatus()
      setPermission(status)
      setIsPushSubscribed(!!subscription)
      
      if (status === 'granted' && subscription) {
        showToast.success('Push notifications enabled')
        await notificationService.showNotification({
          title: 'Notifications Enabled',
          body: 'You will receive notifications when input is needed',
          tag: 'permission-granted',
        })
      } else {
        showToast.error('Notification permission denied')
      }
    } catch (error) {
      console.error('Error toggling notifications:', error)
      showToast.error('Failed to enable push notifications')
    } finally {
      setIsLoading(false)
    }
  }

  const handleTestNotification = async () => {
    if (permission !== 'granted') {
      showToast.error('Notifications must be enabled first')
      return
    }

    try {
      await notificationService.showNotification({
        title: 'Test Notification',
        body: 'This is a test notification from OpenCode Manager',
        tag: 'test-notification',
      })
      showToast.success('Test notification sent')
    } catch (error) {
      console.error('Error sending test notification:', error)
      showToast.error('Failed to send test notification')
    }
  }

  if (!isSupported) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Notifications</Label>
            <div className="text-sm text-muted-foreground">
              Not supported in this browser
            </div>
          </div>
          <BellOff className="h-5 w-5 text-muted-foreground" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label htmlFor="notifications">Push Notifications</Label>
          <div className="text-sm text-muted-foreground">
            Get notified when input is needed or tasks complete
          </div>
        </div>
        <Switch
          id="notifications"
          checked={permission === 'granted' && isPushSubscribed}
          onCheckedChange={handleToggleNotifications}
          disabled={isLoading || permission === 'denied'}
        />
      </div>

      {permission === 'denied' && (
        <div className="text-sm text-destructive">
          Notifications blocked. Enable in browser settings to receive alerts.
        </div>
      )}

      {permission === 'granted' && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleTestNotification}
          className="w-full"
        >
          <Bell className="h-4 w-4 mr-2" />
          Send Test Notification
        </Button>
      )}
    </div>
  )
}
