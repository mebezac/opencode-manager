import type { WebSocket } from 'bun'
import * as k8s from '@kubernetes/client-node'
import { logger } from '../utils/logger'

interface WebSocketData {
  namespace: string
  podName: string
  pty: k8s.PodExec | null
}

function createKubernetesExecWebSocketHandler(kc: k8s.KubeConfig) {
  const coreV1Api = kc.makeApiClient(k8s.CoreV1Api)

  async function handleExecWebSocket(
    ws: WebSocket<WebSocketData>,
    podName: string,
    namespace: string
  ) {
    ws.data.namespace = namespace
    ws.data.podName = podName
    ws.data.pty = null

    try {
      const exec = new k8s.Exec(kc)
      const command = ['/bin/sh', '-i']

      await new Promise<void>((resolve, reject) => {
        exec.exec(
          namespace,
          podName,
          undefined,
          command,
          (stream, data) => {
            if (stream.name === 'stdout') {
              ws.send(data)
            } else if (stream.name === 'stderr') {
              ws.send(`\x1b[31m${data}\x1b[0m`)
            }
          },
          (status) => {
            if (status.status === 'Success') {
              ws.send('\r\n\x1b[32mProcess exited\x1b[0m\r\n')
            } else {
              ws.send(`\r\n\x1b[31mProcess exited with code: ${status.status?.code || 1}\x1b[0m\r\n`)
            }
            resolve()
          },
          true,
          true
        )
      })
    } catch (error) {
      logger.error(`Failed to exec in pod ${podName}:`, error)
      ws.send(`\r\n\x1b[31mError: ${error instanceof Error ? error.message : 'Unknown error'}\x1b[0m\r\n`)
    }

    ws.close()
  }

  return handleExecWebSocket
}

export { createKubernetesExecWebSocketHandler }
export type { WebSocketData }