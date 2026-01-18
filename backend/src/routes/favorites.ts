import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { logger } from '../utils/logger'

export function createFavoritesRoutes(db: Database) {
  const app = new Hono()

  app.get('/', (c) => {
    try {
      const userId = c.req.query('user_id') || 'default'
      
      const favorites = db
        .prepare('SELECT provider_id, model_id, created_at FROM favorite_models WHERE user_id = ? ORDER BY created_at DESC')
        .all(userId) as Array<{ provider_id: string; model_id: string; created_at: number }>

      return c.json({
        favorites: favorites.map(f => ({
          providerID: f.provider_id,
          modelID: f.model_id,
          createdAt: f.created_at
        }))
      })
    } catch (error) {
      logger.error('Failed to get favorite models:', error)
      return c.json({ error: 'Failed to get favorite models' }, 500)
    }
  })

  app.post('/', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default'
      const body = await c.req.json()
      const { providerID, modelID } = body

      if (!providerID || !modelID) {
        return c.json({ error: 'providerID and modelID are required' }, 400)
      }

      db.prepare(
        'INSERT OR IGNORE INTO favorite_models (user_id, provider_id, model_id, created_at) VALUES (?, ?, ?, ?)'
      ).run(userId, providerID, modelID, Date.now())

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to add favorite model:', error)
      return c.json({ error: 'Failed to add favorite model' }, 500)
    }
  })

  app.delete('/', async (c) => {
    try {
      const userId = c.req.query('user_id') || 'default'
      const body = await c.req.json()
      const { providerID, modelID } = body

      if (!providerID || !modelID) {
        return c.json({ error: 'providerID and modelID are required' }, 400)
      }

      db.prepare(
        'DELETE FROM favorite_models WHERE user_id = ? AND provider_id = ? AND model_id = ?'
      ).run(userId, providerID, modelID)

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to remove favorite model:', error)
      return c.json({ error: 'Failed to remove favorite model' }, 500)
    }
  })

  return app
}
