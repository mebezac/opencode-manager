import { logger } from '../utils/logger'
import fs from 'fs'
import yaml from 'js-yaml'
import tls from 'tls'

interface KubeConfig {
  apiVersion: string
  clusters: Array<{
    cluster: {
      'certificate-authority-data'?: string
      server: string
    }
    name: string
  }>
  contexts: Array<{
    context: {
      cluster: string
      user: string
    }
    name: string
  }>
  'current-context': string
  users: Array<{
    name: string
    user: {
      token?: string
      'client-certificate-data'?: string
      'client-key-data'?: string
    }
  }>
}

interface PodInfo {
  podName: string
  namespace: string
}

function loadKubeConfig(): KubeConfig {
  const kubeconfigPath = '/workspace/.kube/kubeconfig'
  const content = fs.readFileSync(kubeconfigPath, 'utf8')
  return yaml.load(content) as KubeConfig
}

function getCurrentContext(config: KubeConfig) {
  const currentContextName = config['current-context']
  const context = config.contexts.find(c => c.name === currentContextName)
  if (!context) throw new Error(`Context ${currentContextName} not found`)

  const cluster = config.clusters.find(c => c.name === context.context.cluster)
  if (!cluster) throw new Error(`Cluster ${context.context.cluster} not found`)

  const user = config.users.find(u => u.name === context.context.user)
  if (!user) throw new Error(`User ${context.context.user} not found`)

  return { cluster, user }
}

export function startKubernetesWebSocketServer(port: number) {
  const server = Bun.serve({
    port,
    fetch(req, server) {
      const url = new URL(req.url)

      if (url.pathname === '/ws/kubernetes/exec') {
        const podName = url.searchParams.get('pod')
        const namespace = url.searchParams.get('namespace')
        const container = url.searchParams.get('container')

        if (!podName || !namespace) {
          return new Response('Missing pod or namespace', { status: 400 })
        }

        const upg = server.upgrade(req, {
          data: { podName, namespace, container },
        })

        if (upg) {
          return undefined
        }

        return new Response('WebSocket upgrade failed', { status: 500 })
      }

      return new Response('Not found', { status: 404 })
    },
    websocket: {
      async open(ws) {
        const { podName, namespace, container } = ws.data as PodInfo & { container?: string }
        logger.info(`Client WebSocket opened for pod ${podName} in ${namespace}`)

        try {
          const config = loadKubeConfig()
          const { cluster, user } = getCurrentContext(config)

          if (!user.user.token) {
            throw new Error('Token-based authentication required')
          }

          // Construct K8s API WebSocket URL
          const baseUrl = cluster.cluster.server.replace('https://', 'wss://')
          const execUrl = new URL(`${baseUrl}/api/v1/namespaces/${namespace}/pods/${podName}/exec`)
          execUrl.searchParams.append('command', '/bin/sh')
          execUrl.searchParams.append('command', '-i')
          execUrl.searchParams.append('stdin', 'true')
          execUrl.searchParams.append('stdout', 'true')
          execUrl.searchParams.append('stderr', 'true')
          execUrl.searchParams.append('tty', 'true')
          if (container) {
            execUrl.searchParams.append('container', container)
          }

          logger.info(`Connecting to K8s API: ${execUrl.toString()}`)

          // Create TLS context with CA cert if available
          let tlsOptions: tls.ConnectionOptions | undefined
          if (cluster.cluster['certificate-authority-data']) {
            const caCert = Buffer.from(cluster.cluster['certificate-authority-data'], 'base64')
            tlsOptions = {
              ca: caCert,
              rejectUnauthorized: true,
            }
          }

          // Open WebSocket to K8s API with authentication
          // K8s exec requires v4.channel.k8s.io subprotocol for proper framing
          const k8sWs = new WebSocket(execUrl.toString(), {
            headers: {
              'Authorization': `Bearer ${user.user.token}`,
            },
            tlsOptions,
            protocols: ['v4.channel.k8s.io'],
          })

          // Store the K8s WebSocket connection
          ;(ws as unknown as { k8sWs: WebSocket }).k8sWs = k8sWs

          k8sWs.onopen = () => {
            logger.info(`Connected to K8s API for pod ${podName}`)
          }

          k8sWs.onmessage = (event) => {
            if (ws.readyState !== WebSocket.OPEN) {
              return
            }

            try {
              const data = event.data

              if (typeof data === 'string') {
                // String data (shouldn't happen with binary protocol, but handle it)
                ws.send(data)
              } else if (data instanceof ArrayBuffer) {
                // Binary data - K8s exec protocol
                const buffer = Buffer.from(data)
                if (buffer.length > 0) {
                  const channel = buffer[0]
                  const payload = buffer.slice(1)

                  // Channel 1 = stdout, Channel 2 = stderr
                  if (channel === 1 || channel === 2) {
                    ws.send(payload.toString())
                  } else if (channel === 3) {
                    // Error channel
                    logger.error('K8s exec error channel:', payload.toString())
                    ws.send(`\r\n\x1b[31mError: ${payload.toString()}\x1b[0m\r\n`)
                  }
                }
              } else if (Buffer.isBuffer(data)) {
                // Handle Buffer directly
                if (data.length > 0) {
                  const channel = data[0]
                  const payload = data.slice(1)

                  if (channel === 1 || channel === 2) {
                    ws.send(payload.toString())
                  } else if (channel === 3) {
                    logger.error('K8s exec error channel:', payload.toString())
                    ws.send(`\r\n\x1b[31mError: ${payload.toString()}\x1b[0m\r\n`)
                  }
                }
              }
            } catch (err) {
              logger.error('Error processing K8s message:', err)
            }
          }

          k8sWs.onerror = (error) => {
            logger.error(`K8s WebSocket error for pod ${podName}:`, error)
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(`\r\n\x1b[31mKubernetes connection error: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m\r\n`)
            }
          }

          k8sWs.onclose = (event) => {
            logger.info(`K8s WebSocket closed for pod ${podName} (code: ${event.code}, reason: ${event.reason || 'none'})`)
            if (ws.readyState === WebSocket.OPEN) {
              ws.send('\r\n\x1b[32mSession closed\x1b[0m\r\n')
              ws.close()
            }
          }
        } catch (error) {
          logger.error(`Failed to connect to K8s for pod ${podName}:`, error)
          ws.send(`\r\n\x1b[31mFailed to connect: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m\r\n`)
          ws.close()
        }
      },
      message(ws, message) {
        const data = message.toString()
        const k8sWs = (ws as unknown as { k8sWs?: WebSocket }).k8sWs

        if (!k8sWs || k8sWs.readyState !== WebSocket.OPEN) {
          return
        }

        try {
          const msg = JSON.parse(data)
          if (msg.type === 'resize') {
            // Handle resize - K8s doesn't support resize over WebSocket directly
            return
          }
        } catch {
          // Not JSON, treat as terminal input
          // Send to stdin channel (0) with binary framing
          const input = Buffer.from(data)
          const framed = Buffer.concat([Buffer.from([0]), input])
          k8sWs.send(framed)
        }
      },
      close(ws) {
        logger.info('Client WebSocket connection closed')
        const k8sWs = (ws as unknown as { k8sWs?: WebSocket }).k8sWs
        if (k8sWs && k8sWs.readyState === WebSocket.OPEN) {
          k8sWs.close()
        }
      },
    },
  })

  logger.info(`Kubernetes WebSocket server running on port ${port}`)
  return server
}
