import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import webpush from 'web-push'
import { logger } from '../utils/logger'

const pushSubscriptionSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string(),
    auth: z.string(),
  }),
})

const pushNotificationSchema = z.object({
  title: z.string(),
  body: z.string(),
  icon: z.string().optional(),
  badge: z.string().optional(),
  data: z.any().optional(),
  tag: z.string().optional(),
})

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:noreply@opencode.dev'

if (!vapidPublicKey || !vapidPrivateKey) {
  logger.warn('VAPID keys not configured. Web push notifications will not work. Generate keys with: npx web-push generate-vapid-keys')
}

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
}

export function createPushRoutes(db: Database) {
  const pushRoutes = new Hono()

  pushRoutes.post('/subscribe', async (c) => {
    try {
      const body = await c.req.json()
      const result = pushSubscriptionSchema.safeParse(body)
      
      if (!result.success) {
        return c.json({ success: false, error: 'Invalid subscription data' }, 400)
      }
      
      const subscription = result.data
      const userId = 'default'

      const existing = db.prepare('SELECT id FROM push_subscriptions WHERE endpoint = ?').get(subscription.endpoint)

      if (existing) {
        db.prepare('UPDATE push_subscriptions SET last_used = ? WHERE endpoint = ?')
          .run(Date.now(), subscription.endpoint)
        return c.json({ success: true, message: 'Subscription updated' })
      }

      db.prepare(`
        INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, last_used)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        userId,
        subscription.endpoint,
        subscription.keys.p256dh,
        subscription.keys.auth,
        Date.now(),
        Date.now()
      )

      logger.info('Push subscription saved', { endpoint: subscription.endpoint })
      return c.json({ success: true, message: 'Subscription saved' })
    } catch (error) {
      logger.error('Failed to save push subscription:', error)
      return c.json({ success: false, error: 'Failed to save subscription' }, 500)
    }
  })

  pushRoutes.post('/unsubscribe', async (c) => {
    try {
      const body = await c.req.json()
      const endpoint = body.endpoint
      
      if (!endpoint || typeof endpoint !== 'string') {
        return c.json({ success: false, error: 'Invalid endpoint' }, 400)
      }
      
      db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint)

      logger.info('Push subscription removed', { endpoint })
      return c.json({ success: true, message: 'Subscription removed' })
    } catch (error) {
      logger.error('Failed to remove push subscription:', error)
      return c.json({ success: false, error: 'Failed to remove subscription' }, 500)
    }
  })

  pushRoutes.post('/send', async (c) => {
    try {
      if (!vapidPublicKey || !vapidPrivateKey) {
        return c.json({ success: false, error: 'Push notifications not configured' }, 500)
      }

      const body = await c.req.json()
      const result = pushNotificationSchema.safeParse(body)
      
      if (!result.success) {
        return c.json({ success: false, error: 'Invalid notification data' }, 400)
      }
      
      const notification = result.data
      const userId = 'default'

      const subscriptions = db.prepare(`
        SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?
      `).all(userId) as Array<{ endpoint: string; p256dh: string; auth: string }>

      if (subscriptions.length === 0) {
        return c.json({ success: true, message: 'No subscriptions found', sent: 0 })
      }

      const payload = JSON.stringify(notification)
      const results = await Promise.allSettled(
        subscriptions.map(async (sub) => {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
              },
              payload
            )
            return { success: true, endpoint: sub.endpoint }
          } catch (error: unknown) {
            if (error && typeof error === 'object' && 'statusCode' in error) {
              const statusCode = (error as { statusCode: number }).statusCode
              if (statusCode === 404 || statusCode === 410) {
                db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(sub.endpoint)
                logger.info('Removed expired push subscription', { endpoint: sub.endpoint })
              }
            }
            throw error
          }
        })
      )

      const successful = results.filter((r) => r.status === 'fulfilled').length
      const failed = results.filter((r) => r.status === 'rejected').length

      logger.info('Push notifications sent', { successful, failed, total: subscriptions.length })

      return c.json({ success: true, sent: successful, failed })
    } catch (error) {
      logger.error('Failed to send push notifications:', error)
      return c.json({ success: false, error: 'Failed to send notifications' }, 500)
    }
  })

  pushRoutes.get('/public-key', async (c) => {
    if (!vapidPublicKey) {
      return c.json({ error: 'VAPID public key not configured' }, 500)
    }
    return c.json({ publicKey: vapidPublicKey })
  })

  return pushRoutes
}
