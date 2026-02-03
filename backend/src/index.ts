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

## Kubernetes-Only Execution

- All tests, builds, package installs, dev servers, and staging/preview environments must run in Kubernetes pods
- Do not run commands locally or install tools locally, except when the user explicitly asks to install MCP servers (typically via npm/npx)
- If Kubernetes is not enabled, stop and request that it be enabled before proceeding

**Prerequisites:** Kubernetes must be enabled in Settings > Kubernetes

### Dev Server Exposure

- Expose dev servers with Kubernetes Services and Ingresses
- Bind to \`0.0.0.0\` inside the pod so Services can route traffic

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

## Kubernetes Integration

**Kubernetes** is required for all execution and provides pod management for isolated testing environments.

### Prerequisites
Before using Kubernetes:
1. Check Settings > Kubernetes to verify the integration is **enabled**
2. Ensure the namespace is configured (default: \`opencode-manager\`)
3. Test the connection to verify cluster access
4. If disabled, do not run anything locally; Kubernetes is required for execution

### Authentication Methods

OpenCode Manager supports two methods for Kubernetes authentication:

#### Method 1: In-Cluster Authentication (Recommended)

When running OpenCode Manager inside a Kubernetes cluster, it automatically uses the pod's ServiceAccount for authentication. No kubeconfig file is required.

**Setup:**

1. Create a ServiceAccount for OpenCode Manager:
\`\`\`yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: opencode-manager
  namespace: opencode-manager
\`\`\`

2. Create a Role with necessary permissions:
\`\`\`yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: opencode-manager-role
  namespace: opencode-manager
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: [""]
  resources: ["pods/exec"]
  verbs: ["create"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get", "list"]
- apiGroups: [""]
  resources: ["services"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
- apiGroups: ["networking.k8s.io"]
  resources: ["ingresses"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
\`\`\`

3. Bind the Role to the ServiceAccount:
\`\`\`yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: opencode-manager-rolebinding
  namespace: opencode-manager
subjects:
- kind: ServiceAccount
  name: opencode-manager
  namespace: opencode-manager
roleRef:
  kind: Role
  name: opencode-manager-role
  apiGroup: rbac.authorization.k8s.io
\`\`\`

4. Assign the ServiceAccount to the OpenCode Manager pod in your deployment:
\`\`\`yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: opencode-manager
  namespace: opencode-manager
spec:
  template:
    spec:
      serviceAccountName: opencode-manager
      containers:
      - name: opencode-manager
        image: opencode-manager:latest
\`\`\`

**Benefits:**
- No kubeconfig file management required
- Automatic credential rotation
- Follows Kubernetes security best practices
- Works seamlessly with kubectl commands inside the pod

#### Method 2: Kubeconfig File

For external cluster access, provide a kubeconfig file path in Settings > Kubernetes. The kubeconfig will be loaded from the specified path (default: \`/workspace/.kube/kubeconfig\`).

### When to Use Kubernetes
- Testing code in isolated, clean environments
- Running integration tests that need specific dependencies
- Executing commands in containerized environments
- Testing deployment configurations
- Creating staging/preview deployments accessible via Ingress
- Iterative debugging workflows (edit → commit → test in pod)

### Matching Container Images to Project Requirements

When creating pods, always match the container image to the project's specified versions:

**Check these files for version requirements (read-only hints from the repo):**
- \`mise.toml\` or \`.tool-versions\` - version manager hints from upstream repo
- \`package.json\` (\`engines.node\`) - Node.js version
- \`.nvmrc\` or \`.node-version\` - Node.js version
- \`.python-version\` - Python version
- \`Dockerfile\` (\`FROM\` image) - Base container image
- \`Gemfile\` (\`ruby\` directive) - Ruby version
- \`go.mod\` (\`go\` directive) - Go version
- \`Cargo.toml\` - Rust version
- \`pom.xml\` or \`build.gradle\` - Java version

**Always use exact versions:**
- ✅ Use: \`node:20.11.0-alpine\`
- ❌ Avoid: \`node:latest\` or \`node:20\`

### Shared PVC Workflow for Iterative Development

For debugging/testing workflows with immediate feedback:

1. **Manager edits code** → commits to git (creates sync point via SHA)
2. **Spawn ephemeral pod** with:
   - Same PVC mounted at \`/workspace/repos\`
   - Commit SHA passed as environment variable
   - Command: \`git checkout $COMMIT_SHA && <test/build command>\`
3. **Pod runs tests** in isolated environment with identical file state
4. **Manager analyzes results**, makes fixes, repeats

**Benefits:** Manager stays responsive, clean environment per iteration, deterministic state via git SHA.

### Available Operations

**Create a pod:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-environment",
    "namespace": "opencode-manager",
    "image": "node:20-alpine",
    "command": ["/bin/sh"],
    "args": ["-c", "sleep 3600"]
  }'
\`\`\`

**List pods:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/pods?namespace=opencode-manager
\`\`\`

**Execute command in pod:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/pods/test-environment/exec \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "opencode-manager",
    "command": ["npm", "test"]
  }'
\`\`\`

**Get pod logs:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/pods/test-environment/logs?namespace=opencode-manager&tailLines=100
\`\`\`

**Delete pod:**
\`\`\`bash
curl -X DELETE http://localhost:5003/api/kubernetes/pods/test-environment?namespace=opencode-manager
\`\`\`

**Cleanup old completed pods:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/cleanup \
  -H "Content-Type: application/json" \
  -d '{"namespace": "opencode-manager"}'
\`\`\`

**Create a service:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "postgres-service",
    "namespace": "opencode-manager",
    "selector": {"app": "postgres"},
    "ports": [{"port": 5432, "targetPort": 5432}],
    "type": "ClusterIP"
  }'
\`\`\`

**List services:**
\`\`\`bash
curl http://localhost:5003/api/kubernetes/services?namespace=opencode-manager
\`\`\`

**Delete service:**
\`\`\`bash
curl -X DELETE http://localhost:5003/api/kubernetes/services/postgres-service?namespace=opencode-manager
\`\`\`

**Create an ingress:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/ingresses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app-ingress",
    "namespace": "opencode-manager",
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
curl http://localhost:5003/api/kubernetes/ingresses?namespace=opencode-manager
\`\`\`

**Delete an ingress:**
\`\`\`bash
curl -X DELETE http://localhost:5003/api/kubernetes/ingresses/my-app-ingress?namespace=opencode-manager
\`\`\`

**Example ingress with nginx WebSocket annotations:**
\`\`\`bash
curl -X POST http://localhost:5003/api/kubernetes/ingresses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "pod-terminal-ingress",
    "namespace": "opencode-manager",
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
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "postgres-db",
    "namespace": "opencode-manager",
    "image": "postgres:15-alpine",
    "labels": {"app": "postgres"},
    "env": {
      "POSTGRES_PASSWORD": "test123",
      "POSTGRES_DB": "myapp"
    }
  }'

# 2. Create service to expose postgres
curl -X POST http://localhost:5003/api/kubernetes/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "postgres-service",
    "namespace": "opencode-manager",
    "selector": {"app": "postgres"},
    "ports": [{"port": 5432, "targetPort": 5432}]
  }'

# 3. Create app pod that connects to postgres via service DNS
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "namespace": "opencode-manager",
    "image": "node:20-alpine",
    "env": {
      "DATABASE_URL": "postgresql://postgres:test123@postgres-service:5432/myapp"
    },
    "command": ["npm", "test"]
  }'
\`\`\`

The app pod can now connect to postgres using the DNS name \`postgres-service\` which resolves within the cluster.

### Example: Shared PVC with Git SHA Synchronization

For iterative debugging where OpenCode Manager edits files and ephemeral pods run tests:

\`\`\`bash
# Create test pod that checks out a specific commit before running tests
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "test-runner-abc123",
    "namespace": "opencode-manager",
    "image": "node:20.11.0-alpine",
    "env": {
      "COMMIT_SHA": "abc123def456",
      "REPO_PATH": "/workspace/repos/myapp"
    },
    "command": ["sh"],
    "args": ["-c", "cd $REPO_PATH && git checkout $COMMIT_SHA && npm ci && npm test"]
  }'

# View test results via logs
curl http://localhost:5003/api/kubernetes/pods/test-runner-abc123/logs?namespace=opencode-manager

# Clean up after reviewing results
curl -X DELETE http://localhost:5003/api/kubernetes/pods/test-runner-abc123?namespace=opencode-manager
\`\`\`

**Workflow:** Manager edits → git commit → spawn pod with that SHA → pod runs tests → manager reviews → repeat

### Example: Staging/Preview Deployment

Create an accessible preview environment:

\`\`\`bash
# 1. Create pod that builds and serves the app
curl -X POST http://localhost:5003/api/kubernetes/pods \
  -H "Content-Type: application/json" \
  -d '{
    "name": "preview-app-abc123",
    "namespace": "opencode-manager",
    "image": "node:20.11.0-alpine",
    "env": {
      "COMMIT_SHA": "abc123",
      "REPO_PATH": "/workspace/repos/myapp"
    },
    "command": ["sh"],
    "args": ["-c", "cd $REPO_PATH && git checkout $COMMIT_SHA && npm ci && npm run build && npm start"],
    "labels": {"app": "preview-abc123"}
  }'

# 2. Create Service to expose the pod
curl -X POST http://localhost:5003/api/kubernetes/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "preview-service-abc123",
    "namespace": "opencode-manager",
    "selector": {"app": "preview-abc123"},
    "ports": [{"port": 3000, "targetPort": 3000}],
    "type": "ClusterIP"
  }'

# 3. Create Ingress for external access
curl -X POST http://localhost:5003/api/kubernetes/ingresses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "preview-ingress-abc123",
    "namespace": "opencode-manager",
    "rules": [{
      "host": "preview-abc123.example.com",
      "http": {
        "paths": [{
          "path": "/",
          "pathType": "Prefix",
          "backend": {
            "service": {
              "name": "preview-service-abc123",
              "port": {"number": 3000}
            }
          }
        }]
      }
    }]
  }'
\`\`\`

The preview is now accessible at the configured hostname.

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
- **Protect the manager pod**: When running OpenCode Manager in the same namespace as test pods, exclude it from cleanup operations by adding a label like \`app=opencode-manager\` to the manager deployment and filtering it out in cleanup operations

## General Guidelines

- This file is merged with any AGENTS.md files in individual repositories
- Repository-specific instructions take precedence for their respective codebases
- Always check if Kubernetes is enabled before suggesting isolated environments
- Keep all execution inside Kubernetes pods; do not run tasks locally
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

const WS_PORT = PORT + 1
const wsServer = startKubernetesWebSocketServer(WS_PORT)
logger.info(`🔌 Kubernetes WebSocket server running on port ${WS_PORT}`)
