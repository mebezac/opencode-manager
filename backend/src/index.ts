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
import { createKubernetesRoutes } from './routes/kubernetes'
import { createFavoritesRoutes } from './routes/favorites'
import { sseAggregator } from './services/sse-aggregator'
import { ensureDirectoryExists, writeFileContent, fileExists, readFileContent } from './services/file-operations'
import { SettingsService } from './services/settings'
import { opencodeServerManager } from './services/opencode-single-server'
import { cleanupOrphanedDirectories } from './services/repo'
import { proxyRequest } from './services/proxy'
import { startKubernetesWebSocketServer, createPtyConnection, resizePty } from './services/kubernetes-websocket'
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

## Dev Server Ports

When starting dev servers, use the pre-allocated ports 5100-5103:
- Port 5100: Primary dev server (frontend)
- Port 5101: Secondary dev server (API/backend)
- Port 5102: Additional service
- Port 5103: Additional service

Always bind to \`0.0.0.0\` to allow external access from the Docker host.

## Package Management

### Node.js Packages
Prefer **pnpm** or **bun** over npm for installing dependencies to save disk space:
- Use \`pnpm install\` instead of \`npm install\`
- Use \`bun install\` as an alternative
- Both are pre-installed in the container

### Python Packages
Always create a virtual environment in the repository directory before installing packages:

1. Create virtual environment in repo:
  \`cd \`<repo_path>\`
  \`uv venv .venv\`

2. Activate the virtual environment:
  \`source .venv/bin/activate\`  # or \`uv pip sync\` for project-based workflows

3. Install packages into activated environment:
  \`uv pip install \`<package>\`
  \`uv pip install -r requirements.txt\`

4. Run Python commands:
  \`python script.py\`  # Uses activated .venv

Alternative: Use \`uv run python script.py\` to skip explicit activation

**Important:**
- Always create .venv in the repository directory (not workspace root)
- Activate the environment before running pip operations
- uv is pre-installed in the container and provides faster package installation
- .venv directories created in repos will persist but can be removed safely

## Tool Version Management with mise

**mise** is pre-installed and configured in the container for managing multiple runtime versions:

### Quick Start
\`\`\`bash
# Install a specific tool version
mise use node@20
mise use python@3.12
mise use ruby@3.2

# Install tools from .mise.toml or .tool-versions file
mise install

# List available tools
mise ls-remote node
mise ls-remote python

# Execute command with specific tool version
mise exec node@18 -- node script.js

# Show current environment
mise current
\`\`\`

### Key Features
- Pre-configured and available in PATH
- Automatically activated in shell sessions
- Install any version of Node.js, Python, Ruby, Go, and 100+ other tools
- Respects .tool-versions and .mise.toml files in repositories
- Zero configuration required - just use \`mise use\` or \`mise install\`

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

## Kubernetes Integration

**Kubernetes** pod management is available for creating isolated testing environments:

### When to Use
- Testing code in isolated, clean environments
- Running integration tests that need specific dependencies
- Executing commands in containerized environments
- Testing deployment configurations

### Prerequisites
The Kubernetes integration must be enabled in Settings > Kubernetes:
1. Enable the integration toggle
2. Configure the namespace (default: \`opencode-testing\`)
3. Optionally set a custom kubeconfig path (default: \`/workspace/.kube/kubeconfig\`)
4. Test the connection to verify cluster access

### Available Operations

**Create a pod:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/pods \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "test-environment",
    "namespace": "opencode-testing",
    "image": "node:20-alpine",
    "command": ["/bin/sh"],
    "args": ["-c", "sleep 3600"]
  }'
\`\`\`

**List pods:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/pods?namespace=opencode-testing
\`\`\`

**Execute command in pod:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/pods/test-environment/exec \\
  -H "Content-Type: application/json" \\
  -d '{
    "namespace": "opencode-testing",
    "command": ["npm", "test"]
  }'
\`\`\`

**Get pod logs:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/pods/test-environment/logs?namespace=opencode-testing&tailLines=100
\`\`\`

**Delete pod:**
\`\`\`bash
curl -X DELETE http://localhost:5003/api/kubernetes/pods/test-environment?namespace=opencode-testing
\`\`\`

**Cleanup old completed pods:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/cleanup \\
  -H "Content-Type: application/json" \\
  -d '{"namespace": "opencode-testing"}'
\`\`\`

**Create a service:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/services \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "postgres-service",
    "namespace": "opencode-testing",
    "selector": {"app": "postgres"},
    "ports": [{"port": 5432, "targetPort": 5432}],
    "type": "ClusterIP"
  }'
\`\`\`

**List services:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/services?namespace=opencode-testing
\`\`\`

**Delete service:**
\`\`\`bash
curl -X DELETE http://localhost:5003/api/kubernetes/services/postgres-service?namespace=opencode-testing
\`\`\`

**Create an ingress:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/ingresses \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-app-ingress",
    "namespace": "opencode-testing",
    "rules": [{
      "host": "myapp.example.com",
      "http": {
        "paths": [{
          "path": "/",
          "pathType": "Prefix",
          "backend": {
            "service": {
              "name": "my-service",
              "port": {"number": 8080}
            }
          }
        }]
      }
    }],
    "annotations": {
      "nginx.ingress.kubernetes.io/rewrite-target": "/"
    }
  }'
\`\`\`

**List ingresses:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/ingresses?namespace=opencode-testing
\`\`\`

**Delete an ingress:**
\`\`\`bash
curl -X DELETE http://localhost:5003/api/kubernetes/ingresses/my-app-ingress?namespace=opencode-testing
\`\`\`

**Example ingress with nginx WebSocket annotations:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/ingresses \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "pod-terminal-ingress",
    "namespace": "opencode-testing",
    "rules": [{
      "host": "terminal.example.com",
      "http": {
        "paths": [{
          "path": "/",
          "pathType": "Prefix",
          "backend": {
            "service": {
              "name": "pod-terminal-service",
              "port": {"number": 5004}
            }
          }
        }]
      }
    }],
    "annotations": {
      "nginx.ingress.kubernetes.io/rewrite-target": "/",
      "nginx.ingress.kubernetes.io/proxy-read-timeout": "3600",
      "nginx.ingress.kubernetes.io/proxy-send-timeout": "3600",
      "nginx.ingress.kubernetes.io/proxy-http-version": "1.1",
      "nginx.ingress.kubernetes.io/proxy-buffering": "off"
    }
  }'
\`\`\`

### Example: Postgres + App Pod Setup

Here's how to set up a postgres database pod with a service and connect an app pod to it:

\`\`\`bash
# 1. Create postgres pod with app=postgres label
curl -X POST http://localhost:5003/api/kubernetes/pods \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "postgres-db",
    "namespace": "opencode-testing",
    "image": "postgres:15-alpine",
    "labels": {"app": "postgres"},
    "env": {
      "POSTGRES_PASSWORD": "test123",
      "POSTGRES_DB": "myapp"
    }
  }'

# 2. Create service to expose postgres
curl -X POST http://localhost:5003/api/kubernetes/services \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "postgres-service",
    "namespace": "opencode-testing",
    "selector": {"app": "postgres"},
    "ports": [{"port": 5432, "targetPort": 5432}]
  }'

# 3. Create app pod that connects to postgres via service DNS
curl -X POST http://localhost:5003/api/kubernetes/pods \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "my-app",
    "namespace": "opencode-testing",
    "image": "node:20-alpine",
    "env": {
      "DATABASE_URL": "postgresql://postgres:test123@postgres-service:5432/myapp"
    },
    "command": ["npm", "test"]
  }'
\`\`\`

The app pod can now connect to postgres using the DNS name \`postgres-service\` which resolves within the cluster.

### Important Notes
- All pods created are labeled with \`managed-by=opencode-manager\`
- Pods use \`restartPolicy: Never\` by default
- The container name is always \`runner\`
- Services created are labeled with \`managed-by=opencode-manager\`
- Ingresses created are labeled with \`managed-by=opencode-manager\`
- Pod labels can be customized via the \`labels\` field to enable service selectors
- Only namespace-scoped operations are allowed (no cluster-wide access)
- Requires proper RBAC permissions in the Kubernetes cluster
- Ingress operations require RBAC permissions for \`ingresses\` resource in \`networking.k8s.io\` apiGroup

## General Guidelines

- This file is merged with any AGENTS.md files in individual repositories
- Repository-specific instructions take precedence for their respective codebases
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
  if (userSettings.preferences.kubernetesConfig) {
    const { kubernetesService } = await import('./services/kubernetes')
    kubernetesService.updateConfig(userSettings.preferences.kubernetesConfig)
    logger.info('Kubernetes service initialized with user config')
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
app.route('/api/kubernetes', createKubernetesRoutes(db))
app.route('/api/favorites', createFavoritesRoutes(db))

app.all('/api/opencode/*', async (c) => {
  const request = c.req.raw
  return proxyRequest(request)
})

const isProduction = ENV.SERVER.NODE_ENV === 'production'

if (isProduction) {
  app.use('/*', serveStatic({ root: './frontend/dist' }))
  
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) {
      return c.notFound()
    }
    const fs = await import('fs/promises')
    const path = await import('path')
    const indexPath = path.join(process.cwd(), 'frontend/dist/index.html')
    const html = await fs.readFile(indexPath, 'utf-8')
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

const WS_PORT = PORT + 1
const wsServer = startKubernetesWebSocketServer(WS_PORT)
logger.info(`🔌 Kubernetes WebSocket server running on port ${WS_PORT}`)
