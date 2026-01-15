export type NotificationPermissionStatus = 'default' | 'granted' | 'denied'

export interface NotificationOptions {
  title: string
  body: string
  icon?: string
  badge?: string
  tag?: string
  requireInteraction?: boolean
  silent?: boolean
  data?: unknown
}

class NotificationService {
  private static instance: NotificationService
  private permissionStatus: NotificationPermissionStatus = 'default'
  private serviceWorkerRegistration: ServiceWorkerRegistration | null = null

  private constructor() {
    this.checkPermissionStatus()
  }

  static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService()
    }
    return NotificationService.instance
  }

  isSupported(): boolean {
    return 'Notification' in window && 'serviceWorker' in navigator
  }

  async checkPermissionStatus(): Promise<NotificationPermissionStatus> {
    if (!this.isSupported()) {
      return 'denied'
    }

    this.permissionStatus = Notification.permission
    return this.permissionStatus
  }

  async requestPermission(): Promise<NotificationPermissionStatus> {
    if (!this.isSupported()) {
      throw new Error('Notifications are not supported in this browser')
    }

    if (this.permissionStatus === 'granted') {
      return 'granted'
    }

    const permission = await Notification.requestPermission()
    this.permissionStatus = permission
    return permission
  }

  setServiceWorkerRegistration(registration: ServiceWorkerRegistration): void {
    this.serviceWorkerRegistration = registration
  }

  async showNotification(options: NotificationOptions): Promise<void> {
    const permission = await this.checkPermissionStatus()

    if (permission !== 'granted') {
      console.warn('Notification permission not granted')
      return
    }

    if (!this.isSupported()) {
      console.warn('Notifications not supported')
      return
    }

    const notificationOptions: globalThis.NotificationOptions = {
      body: options.body,
      icon: options.icon || '/favicon.svg',
      badge: options.badge || '/favicon.svg',
      tag: options.tag,
      requireInteraction: options.requireInteraction ?? true,
      silent: options.silent ?? false,
      data: options.data,
      timestamp: Date.now(),
    }

    if (this.serviceWorkerRegistration) {
      await this.serviceWorkerRegistration.showNotification(
        options.title,
        notificationOptions
      )
    } else {
      new Notification(options.title, notificationOptions)
    }
  }

  getPermissionStatus(): NotificationPermissionStatus {
    return this.permissionStatus
  }

  async requestPermissionIfNeeded(): Promise<NotificationPermissionStatus> {
    const status = await this.checkPermissionStatus()
    if (status === 'default') {
      return await this.requestPermission()
    }
    return status
  }
}

export const notificationService = NotificationService.getInstance()

export async function showNotification(options: NotificationOptions): Promise<void> {
  return notificationService.showNotification(options)
}

export async function requestNotificationPermission(): Promise<NotificationPermissionStatus> {
  return notificationService.requestPermission()
}

export function checkNotificationSupport(): boolean {
  return notificationService.isSupported()
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  return notificationService.checkPermissionStatus()
}
