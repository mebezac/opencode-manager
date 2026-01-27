import { Hono } from 'hono'
import type { Database } from 'bun:sqlite'
import { opencodeServerManager } from '../services/opencode-single-server'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { logger } from '../utils/logger'

function getAppVersion(): string {
  const possiblePaths = [
    join(process.cwd(), 'package.json'),
    join(process.cwd(), '..', 'package.json'),
    join(process.cwd(), '..', '..', 'package.json'),
  ]

  logger.info('[Version] Attempting to read version from package.json')
  logger.info('[Version] Current working directory:', process.cwd())

  for (const packagePath of possiblePaths) {
    try {
      logger.info(`[Version] Trying path: ${packagePath}`)
      
      if (!existsSync(packagePath)) {
        logger.info(`[Version] File does not exist at: ${packagePath}`)
        continue
      }

      const packageJson = JSON.parse(readFileSync(packagePath, 'utf-8'))
      const version = packageJson.version || 'unknown'
      
      logger.info(`[Version] Successfully read version: ${version} from ${packagePath}`)
      return version
    } catch (error) {
      logger.warn(`[Version] Failed to read from ${packagePath}:`, error)
    }
  }

  logger.error('[Version] Could not find package.json in any expected location')
  return 'unknown'
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
    const version = getAppVersion()
    const opencodeVersion = opencodeServerManager.getVersion()
    const opencodeMinVersion = opencodeServerManager.getMinVersion()
    const opencodeVersionSupported = opencodeServerManager.isVersionSupported()

    logger.info('[Version Endpoint] Responding with:', {
      version,
      opencodeVersion,
      opencodeMinVersion,
      opencodeVersionSupported
    })

    return c.json({
      version,
      opencodeVersion,
      opencodeMinVersion,
      opencodeVersionSupported
    })
  })

  return app
}
