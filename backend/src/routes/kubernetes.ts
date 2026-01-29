import { Hono } from 'hono'
import { z } from 'zod'
import type { Database } from 'bun:sqlite'
import { kubernetesService } from '../services/kubernetes'
import { logger } from '../utils/logger'
import { SettingsService } from '../services/settings'
import { ENV } from '@opencode-manager/shared/config/env'

const UpdateK8sConfigSchema = z.object({
  enabled: z.boolean(),
  namespace: z.string().optional(),
  kubeconfigPath: z.string().optional(),
})

const CreatePodSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  image: z.string().min(1),
  command: z.array(z.string()).optional(),
  args: z.array(z.string()).optional(),
  workingDir: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  mountPath: z.string().optional(),
  hostPath: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
})

const ExecPodSchema = z.object({
  namespace: z.string().min(1),
  command: z.array(z.string().min(1)),
})

const ServicePortSchema = z.object({
  name: z.string().optional(),
  port: z.number().int().min(1).max(65535),
  targetPort: z.number().int().min(1).max(65535).optional(),
  protocol: z.enum(['TCP', 'UDP', 'SCTP']).optional(),
})

const CreateServiceSchema = z.object({
  name: z.string().min(1),
  namespace: z.string().min(1),
  selector: z.record(z.string(), z.string()),
  ports: z.array(ServicePortSchema).min(1),
  type: z.enum(['ClusterIP', 'NodePort', 'LoadBalancer']).optional(),
})

export function createKubernetesRoutes(db: Database) {
  const app = new Hono()
  const settingsService = new SettingsService(db)

  app.get('/config', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const settings = settingsService.getSettings(userId)

      const k8sConfig = settings.preferences.kubernetesConfig || {
        enabled: false,
        namespace: 'opencode-testing',
      }

      const connectionStatus = k8sConfig.enabled
        ? await kubernetesService.testConnection()
        : { connected: false }

      return c.json({
        config: k8sConfig,
        connection: connectionStatus,
      })
    } catch (error) {
      logger.error('Failed to get Kubernetes config:', error)
      return c.json({ error: 'Failed to get Kubernetes config' }, 500)
    }
  })

  app.put('/config', async (c) => {
    try {
      const userId = c.req.query('userId') || 'default'
      const body = await c.req.json()
      const validated = UpdateK8sConfigSchema.parse(body)

      const currentSettings = settingsService.getSettings(userId)
      const newConfig = {
        ...currentSettings.preferences.kubernetesConfig,
        ...validated,
      }
      
      settingsService.updateSettings(
        {
          kubernetesConfig: newConfig,
        },
        userId
      )

      kubernetesService.updateConfig(newConfig)

      return c.json({ success: true, config: validated })
    } catch (error) {
      logger.error('Failed to update Kubernetes config:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid config data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to update Kubernetes config' }, 500)
    }
  })

  app.post('/test-connection', async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}))
      const namespace = body.namespace || kubernetesService.getCurrentNamespace()
      const result = await kubernetesService.testConnection(namespace)
      return c.json(result)
    } catch (error) {
      logger.error('Failed to test Kubernetes connection:', error)
      return c.json(
        {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      )
    }
  })

  app.get('/pods', async (c) => {
    try {
      const namespace = c.req.query('namespace')
      const labelSelector = c.req.query('labelSelector')

      const pods = await kubernetesService.listPods(namespace, labelSelector)
      return c.json({ pods })
    } catch (error) {
      logger.error('Failed to list pods:', error)
      return c.json({ error: 'Failed to list pods' }, 500)
    }
  })

  app.get('/pods/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const namespace = c.req.query('namespace')

      if (!namespace) {
        return c.json({ error: 'Namespace query parameter required' }, 400)
      }

      const pod = await kubernetesService.getPod(name, namespace)

      if (!pod) {
        return c.json({ error: 'Pod not found' }, 404)
      }

      return c.json({ pod })
    } catch (error) {
      logger.error('Failed to get pod:', error)
      return c.json({ error: 'Failed to get pod' }, 500)
    }
  })

  app.post('/pods', async (c) => {
    try {
      const body = await c.req.json()
      const validated = CreatePodSchema.parse(body)

      const podName = await kubernetesService.createPod({
        name: validated.name,
        namespace: validated.namespace,
        image: validated.image,
        command: validated.command,
        args: validated.args,
        workingDir: validated.workingDir,
        volumeMounts: validated.mountPath && validated.hostPath
          ? [
              {
                name: 'workspace',
                mountPath: validated.mountPath,
              },
            ]
          : undefined,
        volumes: validated.mountPath && validated.hostPath
          ? [
              {
                name: 'workspace',
                hostPath: {
                  path: validated.hostPath,
                },
              },
            ]
          : undefined,
        env: validated.env as Record<string, string>,
        labels: validated.labels,
      })

      return c.json({ success: true, podName })
    } catch (error) {
      logger.error('Failed to create pod:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid pod data', details: error.issues }, 400)
      }
      return c.json(
        {
          error: 'Failed to create pod',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      )
    }
  })

  app.delete('/pods/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const namespace = c.req.query('namespace')

      if (!namespace) {
        return c.json({ error: 'Namespace query parameter required' }, 400)
      }

      const success = await kubernetesService.deletePod(name, namespace)

      if (!success) {
        return c.json({ error: 'Failed to delete pod' }, 500)
      }

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete pod:', error)
      return c.json({ error: 'Failed to delete pod' }, 500)
    }
  })

  app.get('/pods/:name/logs', async (c) => {
    try {
      const name = c.req.param('name')
      const namespace = c.req.query('namespace')
      const tailLines = c.req.query('tailLines')
        ? parseInt(c.req.query('tailLines') as string)
        : undefined

      if (!namespace) {
        return c.json({ error: 'Namespace query parameter required' }, 400)
      }

      const logs = await kubernetesService.getPodLogs(
        name,
        namespace,
        tailLines
      )

      return c.json({ logs })
    } catch (error) {
      logger.error('Failed to get pod logs:', error)
      return c.json({ error: 'Failed to get pod logs' }, 500)
    }
  })

  app.post('/pods/:name/exec', async (c) => {
    try {
      const name = c.req.param('name')
      const body = await c.req.json()
      const validated = ExecPodSchema.parse(body)

      const output: string[] = []
      const errors: string[] = []

      const exitCode = await kubernetesService.execInPod(
        name,
        validated.namespace,
        validated.command,
        (data) => {
          output.push(data)
        },
        (data) => {
          errors.push(data)
        }
      )

      return c.json({
        success: true,
        exitCode,
        output: output.join(''),
        errors: errors.join(''),
      })
    } catch (error) {
      logger.error('Failed to exec in pod:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to exec in pod' }, 500)
    }
  })

  app.post('/cleanup', async (c) => {
    try {
      const body = await c.req.json()
      const { namespace, maxAgeMs } = z
        .object({
          namespace: z.string().min(1),
          maxAgeMs: z.number().optional(),
        })
        .parse(body)

      const deleted = await kubernetesService.cleanupOldPods(namespace, maxAgeMs)

      return c.json({ success: true, deleted })
    } catch (error) {
      logger.error('Failed to cleanup pods:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid request data', details: error.issues }, 400)
      }
      return c.json({ error: 'Failed to cleanup pods' }, 500)
    }
  })

  app.get('/services', async (c) => {
    try {
      const namespace = c.req.query('namespace')
      const labelSelector = c.req.query('labelSelector')

      const services = await kubernetesService.listServices(namespace, labelSelector)
      return c.json({ services })
    } catch (error) {
      logger.error('Failed to list services:', error)
      return c.json({ error: 'Failed to list services' }, 500)
    }
  })

  app.get('/services/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const namespace = c.req.query('namespace')

      if (!namespace) {
        return c.json({ error: 'Namespace query parameter required' }, 400)
      }

      const service = await kubernetesService.getService(name, namespace)

      if (!service) {
        return c.json({ error: 'Service not found' }, 404)
      }

      return c.json({ service })
    } catch (error) {
      logger.error('Failed to get service:', error)
      return c.json({ error: 'Failed to get service' }, 500)
    }
  })

  app.post('/services', async (c) => {
    try {
      const body = await c.req.json()
      const validated = CreateServiceSchema.parse(body)

      const serviceName = await kubernetesService.createService({
        name: validated.name,
        namespace: validated.namespace,
        selector: validated.selector,
        ports: validated.ports,
        type: validated.type,
      })

      return c.json({ success: true, serviceName })
    } catch (error) {
      logger.error('Failed to create service:', error)
      if (error instanceof z.ZodError) {
        return c.json({ error: 'Invalid service data', details: error.issues }, 400)
      }
      return c.json(
        {
          error: 'Failed to create service',
          details: error instanceof Error ? error.message : 'Unknown error',
        },
        500
      )
    }
  })

  app.delete('/services/:name', async (c) => {
    try {
      const name = c.req.param('name')
      const namespace = c.req.query('namespace')

      if (!namespace) {
        return c.json({ error: 'Namespace query parameter required' }, 400)
      }

      const success = await kubernetesService.deleteService(name, namespace)

      if (!success) {
        return c.json({ error: 'Failed to delete service' }, 500)
      }

      return c.json({ success: true })
    } catch (error) {
      logger.error('Failed to delete service:', error)
      return c.json({ error: 'Failed to delete service' }, 500)
    }
  })

  app.get('/exec-ws-url', async (c) => {
    const podName = c.req.query('pod')
    const namespace = c.req.query('namespace')

    if (!podName || !namespace) {
      return c.json({ error: 'pod and namespace query parameters required' }, 400)
    }

    const port = parseInt(ENV.SERVER.PORT) + 1
    const protocol = c.req.header('x-forwarded-proto') || 'http'
    const host = c.req.header('host')?.split(':')[0] || 'localhost'

    return c.json({
      wsUrl: `${protocol === 'https' ? 'wss' : 'ws'}://${host}:${port}/ws/kubernetes/exec?pod=${encodeURIComponent(podName)}&namespace=${encodeURIComponent(namespace)}`,
    })
  })

  return app
}
