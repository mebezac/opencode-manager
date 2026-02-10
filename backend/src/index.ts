import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import os from 'os'
import path from 'path'
import { initializeDatabase } from './db/schema'
import { createRepoRoutes } from './routes/repos'
import { createIPCServer, type IPCServer } from './ipc/ipcServer'
import { GitAuthService } from './services/git-auth'
import { createSettingsRoutes } from './routes/settings'
import { createHealthRoutes } from './routes/health'

import { createFileRoutes } from './routes/files'
import { createProvidersRoutes } from './routes/providers'
import { createOAuthRoutes } from './routes/oauth'
import { createTitleRoutes } from './routes/title'
import { createSSERoutes } from './routes/sse'
import { createPushRoutes } from './routes/push'
import { createFavoritesRoutes } from './routes/favorites'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists, readFileContent } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { cleanupOrphanedDirectories } from './services/repo'
import { proxyRequest } from './services/proxy'
import { logger } from './utils/logger'
import { 
  getWorkspacePath, 
  getReposPath, 
  getConfigPath,
  getOpenCodeConfigFilePath,
  getAgentsMdPath,
  getDatabasePath,
  ENV
} from '@opencode-manager/shared/config/env'
import { OpenCodeConfigSchema } from '@opencode-manager/shared/schemas'
import stripJsonComments from 'strip-json-comments'

const { PORT, HOST } = ENV.SERVER
const DB_PATH = getDatabasePath()

const app = new Hono()

app.use('/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

const db = initializeDatabase(DB_PATH)

let ipcServer: IPCServer | undefined
const gitAuthService = new GitAuthService()

export const DEFAULT_AGENTS_MD = `# OpenCode Manager - Global Agent Instructions

## Critical System Constraints

- **DO NOT** use ports 5003 or 5551 - these are reserved for OpenCode Manager
- **DO NOT** kill or stop processes on ports 5003 or 5551
- **DO NOT** modify files in the \`.config/opencode\` directory unless explicitly requested

## Mise-first Tooling Workflow

- Before running project commands, check the repository for a \`mise.toml\` file
- If \`mise.toml\` exists, run \`mise install\` at the project root first to install required runtimes and tools
- Use mise-managed tools for execution after install (for example, run commands through \`mise exec -- <command>\` when you need to guarantee the project-pinned versions)
- If a project does not include \`mise.toml\`, use the preinstalled base-image tools directly

### Version Hints to Respect

Check these files and honor exact versions when selecting runtimes/tools:
- \`mise.toml\` or \`.tool-versions\`
- \`package.json\` (\`engines.node\`)
- \`.nvmrc\` or \`.node-version\`
- \`.python-version\`
- \`Dockerfile\` (\`FROM\` image)
- \`Gemfile\` (\`ruby\` directive)
- \`go.mod\` (\`go\` directive)
- \`Cargo.toml\`
- \`pom.xml\` or \`build.gradle\`

## Preinstalled Base-Image Tools

- \`gh\`: GitHub CLI for pull requests, issues, releases, checks, and repository operations.
- \`jq\`: Fast JSON processor for filtering, transforming, and formatting structured command output.
- \`rclone\`: Sync and copy files to and from cloud/object storage providers.
- \`rg\`: Ripgrep for fast recursive code and text search across repositories.
- \`bat\`: Enhanced file viewer with syntax highlighting and line numbers for safer quick reads.
- \`lazygit\`: Terminal UI for common Git workflows when a visual Git interface helps.
- \`tree\`: Display directory structure to quickly inspect repository layout.
- \`zip\`/\`unzip\`: Create and extract archive files used in build and release workflows.
- \`rsync\`: Efficient local or remote file synchronization with delta transfers.
- \`lsof\`: Inspect open files and process-port bindings during debugging.
- \`htop\`/\`iftop\`: Monitor process and network activity for runtime diagnostics.
- \`sqlite3\`: Inspect and query SQLite databases from the command line.
- \`uv\`: Python package and tool manager for fast, reproducible Python tooling.

## GitHub CLI

**gh** is pre-installed and **automatically authenticated** using your GitHub PAT from settings:

### Authentication
- GitHub CLI is pre-authenticated with your stored GitHub token
- No need to run \`gh auth login\` - it's already configured
- All \`gh\` commands will work immediately

### Common Operations
\`\`\`bash
# Create pull requests
gh pr create --title "Feature" --body "Description"

# List and view PRs
gh pr list
gh pr view 123

# Work with issues
gh issue create --title "Bug report"
gh issue list

# Create releases
gh release create v1.0.0 --title "Release" --notes "Changes"

# Clone repositories (uses your authentication)
gh repo clone owner/repo

# View repository info
gh repo view
\`\`\`

### Important Notes
- Authentication is automatic - token is injected from your settings
- Works seamlessly with private repositories
- No manual token management needed
- **Multiple GitHub PATs:** When multiple GitHub tokens are configured, the system uses the **first** credential for all \`gh\` CLI operations. Ensure your primary token has access to all required repositories, or reorder credentials in Settings so the most versatile token is listed first

## General Guidelines

- This file is merged with any AGENTS.md files in individual repositories
- Repository-specific instructions take precedence for their respective codebases
- Prefer project-defined tooling and versions over global defaults
`

async function ensureDefaultConfigExists(): Promise<void> {
  const settingsService = new SettingsService(db)
  const workspaceConfigPath = getOpenCodeConfigFilePath()
  
  if (await fileExists(workspaceConfigPath)) {
    logger.info(`Found workspace config at ${workspaceConfigPath}, syncing to database...`)
    try {
      const rawContent = await readFileContent(workspaceConfigPath)
      const parsed = JSON.parse(stripJsonComments(rawContent))
      const validation = OpenCodeConfigSchema.safeParse(parsed)
      
      if (!validation.success) {
        logger.warn('Workspace config has invalid structure', validation.error)
      } else {
        const existingDefault = settingsService.getOpenCodeConfigByName('default')
        if (existingDefault) {
          settingsService.updateOpenCodeConfig('default', {
            content: rawContent,
            isDefault: true,
          })
          logger.info('Updated database config from workspace file')
        } else {
          settingsService.createOpenCodeConfig({
            name: 'default',
            content: rawContent,
            isDefault: true,
          })
          logger.info('Created database config from workspace file')
        }
        return
      }
    } catch (error) {
      logger.warn('Failed to read workspace config', error)
    }
  }
  
  const homeConfigPath = path.join(os.homedir(), '.config/opencode/opencode.json')
  if (await fileExists(homeConfigPath)) {
    logger.info(`Found home config at ${homeConfigPath}, importing...`)
    try {
      const rawContent = await readFileContent(homeConfigPath)
      const parsed = JSON.parse(stripJsonComments(rawContent))
      const validation = OpenCodeConfigSchema.safeParse(parsed)
      
      if (validation.success) {
        const existingDefault = settingsService.getOpenCodeConfigByName('default')
        if (existingDefault) {
          settingsService.updateOpenCodeConfig('default', {
            content: rawContent,
            isDefault: true,
          })
        } else {
          settingsService.createOpenCodeConfig({
            name: 'default',
            content: rawContent,
            isDefault: true,
          })
        }
        
        await writeFileContent(workspaceConfigPath, rawContent)
        logger.info('Imported home config to workspace')
        return
      }
    } catch (error) {
      logger.warn('Failed to import home config', error)
    }
  }
  
  const existingDbConfigs = settingsService.getOpenCodeConfigs()
  if (existingDbConfigs.configs.length > 0) {
    const defaultConfig = settingsService.getDefaultOpenCodeConfig()
    if (defaultConfig) {
      await writeFileContent(workspaceConfigPath, defaultConfig.rawContent)
      logger.info('Wrote existing database config to workspace file')
    }
    return
  }
  
  logger.info('No existing config found, creating minimal seed config')
  const seedConfig = JSON.stringify({ $schema: 'https://opencode.ai/config.json' }, null, 2)
  settingsService.createOpenCodeConfig({
    name: 'default',
    content: seedConfig,
    isDefault: true,
  })
  await writeFileContent(workspaceConfigPath, seedConfig)
  logger.info('Created minimal seed config')
}

async function ensureDefaultAgentsMdExists(): Promise<void> {
  const agentsMdPath = getAgentsMdPath()
  const exists = await fileExists(agentsMdPath)
  
  if (!exists) {
    await writeFileContent(agentsMdPath, DEFAULT_AGENTS_MD)
    logger.info(`Created default AGENTS.md at: ${agentsMdPath}`)
  }
}

try {
  await ensureDirectoryExists(getWorkspacePath())
  await ensureDirectoryExists(getReposPath())
  await ensureDirectoryExists(getConfigPath())
  logger.info('Workspace directories initialized')

  await cleanupOrphanedDirectories(db)
  logger.info('Orphaned directory cleanup completed')

  await ensureDefaultConfigExists()
  await ensureDefaultAgentsMdExists()

  const settingsService = new SettingsService(db)
  settingsService.initializeLastKnownGoodConfig()

  const userSettings = settingsService.getSettings('default')
  
  try {
    const { GhHostsService } = await import('./services/gh-hosts')
    const ghHostsService = new GhHostsService()
    ghHostsService.syncCredentialsToHosts(userSettings.preferences.gitCredentials)
    logger.info('Synced git credentials to gh hosts.yml on startup')
  } catch (error) {
    logger.error('Failed to sync git credentials to gh hosts.yml on startup:', error)
  }

  ipcServer = await createIPCServer(process.env.STORAGE_PATH || undefined)
  gitAuthService.initialize(ipcServer, db)
  logger.info(`Git IPC server running at ${ipcServer.ipcHandlePath}`)

  opencodeServerManager.setDatabase(db)
  await opencodeServerManager.start()
  logger.info(`OpenCode server running on port ${opencodeServerManager.getPort()}`)
} catch (error) {
  logger.error('Failed to initialize workspace:', error)
}

app.route('/api/repos', createRepoRoutes(db, gitAuthService))
app.route('/api/settings', createSettingsRoutes(db))
app.route('/api/health', createHealthRoutes(db))
app.route('/api/files', createFileRoutes())
app.route('/api/providers', createProvidersRoutes())
app.route('/api/oauth', createOAuthRoutes())

app.route('/api/generate-title', createTitleRoutes())
app.route('/api/sse', createSSERoutes())
app.route('/api/push', createPushRoutes(db))
app.route('/api/favorites', createFavoritesRoutes(db))

app.all('/api/opencode/*', async (c) => {
  const request = c.req.raw
  return proxyRequest(request)
})

const isProduction = ENV.SERVER.NODE_ENV === 'production'

if (isProduction) {
  app.use('/assets/*', async (c, next) => {
    await next()
    c.header('Cache-Control', 'public, max-age=31536000, immutable')
  })
  
  app.use('/*', serveStatic({ root: './frontend/dist' }))
  
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound()
    }
    const fs = await import('fs/promises')
    const path = await import('path')
    const indexPath = path.join(process.cwd(), 'frontend/dist/index.html')
    const html = await fs.readFile(indexPath, 'utf-8')
    c.header('Cache-Control', 'no-cache, no-store, must-revalidate')
    c.header('Pragma', 'no-cache')
    c.header('Expires', '0')
    return c.html(html)
  })
} else {
  app.get('/', (c) => {
    return c.json({
      name: 'OpenCode WebUI',
      version: '2.0.0',
      status: 'running',
      endpoints: {
        health: '/api/health',
        repos: '/api/repos',
        settings: '/api/settings',
        sessions: '/api/sessions',
        files: '/api/files',
        providers: '/api/providers',
        opencode_proxy: '/api/opencode/*'
      }
    })
  })

  app.get('/api/network-info', async (c) => {
    const os = await import('os')
    const interfaces = os.networkInterfaces()
    const ips = Object.values(interfaces)
      .flat()
      .filter(info => info && !info.internal && info.family === 'IPv4')
      .map(info => info!.address)
    
    const requestHost = c.req.header('host') || `localhost:${PORT}`
    const protocol = c.req.header('x-forwarded-proto') || 'http'
    
    return c.json({
      host: HOST,
      port: PORT,
      requestHost,
      protocol,
      availableIps: ips,
      apiUrls: [
        `${protocol}://localhost:${PORT}`,
        ...ips.map(ip => `${protocol}://${ip}:${PORT}`)
      ]
    })
  })
}

let isShuttingDown = false

const shutdown = async (signal: string) => {
  if (isShuttingDown) return
  isShuttingDown = true

  logger.info(`${signal} received, shutting down gracefully...`)
  try {
    sseAggregator.shutdown()
    logger.info('SSE Aggregator stopped')
    if (ipcServer) {
      ipcServer.dispose()
      logger.info('Git IPC server stopped')
    }
    await opencodeServerManager.stop()
    logger.info('OpenCode server stopped')
  } catch (error) {
    logger.error('Error during shutdown:', error)
  }
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

const server = serve({
  fetch: app.fetch,
  port: PORT,
  hostname: HOST,
})

server.timeout = 900000

logger.info(`🚀 OpenCode WebUI API running on http://${HOST}:${PORT}`)

logger.info(`🚀 OpenCode WebUI API running on http://${HOST}:${PORT}`);
