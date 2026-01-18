import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import { readFileSync } from 'fs'
import { join } from 'path'

function getAppVersion(): string {
  try {
    const packageJson = JSON.parse(
      readFileSync(join(process.cwd(), 'package.json'), 'utf-8')
    )
    return packageJson.version || 'unknown'
  } catch {
    return 'unknown'
  }
}

export function createHealthRoutes(db: Database) {
  const app = new Hono()

  app.get('/', async (c) => {
    try {
      const dbCheck = db.prepare('SELECT 1').get()
      const opencodeHealthy = await opencodeServerManager.checkHealth()
      const startupError = opencodeServerManager.getLastStartupError()

      const status = startupError && !opencodeHealthy
        ? 'unhealthy'
        : (dbCheck && opencodeHealthy ? 'healthy' : 'degraded')

      const response: Record<string, unknown> = {
        status,
        timestamp: new Date().toISOString(),
        database: dbCheck ? 'connected' : 'disconnected',
        opencode: opencodeHealthy ? 'healthy' : 'unhealthy',
        opencodePort: opencodeServerManager.getPort(),
        opencodeVersion: opencodeServerManager.getVersion(),
        opencodeMinVersion: opencodeServerManager.getMinVersion(),
        opencodeVersionSupported: opencodeServerManager.isVersionSupported()
      }

      if (startupError && !opencodeHealthy) {
        response.error = startupError
      }

      return c.json(response)
    } catch (error) {
      return c.json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      }, 503)
    }
  })

  app.get('/processes', async (c) => {
    try {
      const opencodeHealthy = await opencodeServerManager.checkHealth()
      
      return c.json({
        opencode: {
          port: opencodeServerManager.getPort(),
          healthy: opencodeHealthy
        },
        timestamp: new Date().toISOString()
      })
    } catch (error) {
      return c.json({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }, 500)
    }
  })

  app.get('/version', (c) => {
    return c.json({
      version: getAppVersion(),
      opencodeVersion: opencodeServerManager.getVersion(),
      opencodeMinVersion: opencodeServerManager.getMinVersion(),
      opencodeVersionSupported: opencodeServerManager.isVersionSupported()
    })
  })

  return app
}
