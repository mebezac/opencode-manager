import * as k8s from '@kubernetes/client-node'
import * as fs from 'fs/promises'
import * as path from 'path'
import { logger } from '../utils/logger'

interface KubernetesConfig {
  enabled: boolean
  namespace?: string
  kubeconfigPath?: string
}

interface PodStatus {
  name: string
  namespace: string
  phase: string
  ready: boolean
  age: number
  image?: string
}

interface CreatePodOptions {
  name: string
  namespace: string
  image: string
  command?: string[]
  args?: string[]
  workingDir?: string
  volumeMounts?: Array<{
    name: string
    mountPath: string
  }>
  volumes?: Array<{
    name: string
    hostPath?: {
      path: string
    }
  }>
  env?: Record<string, string>
  labels?: Record<string, string>
}

interface ServicePort {
  name?: string
  port: number
  targetPort?: number
  protocol?: string
}

interface CreateServiceOptions {
  name: string
  namespace: string
  selector: Record<string, string>
  ports: ServicePort[]
  type?: 'ClusterIP' | 'NodePort' | 'LoadBalancer'
}

interface ServiceStatus {
  name: string
  namespace: string
  type: string
  clusterIP?: string
  ports: Array<{
    port: number
    targetPort: number
    protocol: string
  }>
  selector: Record<string, string>
  age: number
}

export class KubernetesService {
  private kc: k8s.KubeConfig | null = null
  private coreV1Api: k8s.CoreV1Api | null = null
  private config: KubernetesConfig = { enabled: false }

  constructor(config?: KubernetesConfig) {
    if (config?.enabled) {
      this.config = config
      this.initialize()
    }
  }

  updateConfig(config: KubernetesConfig): void {
    this.config = config
    this.kc = null
    this.coreV1Api = null
    
    if (config.enabled) {
      this.initialize()
    }
  }

  private async initialize(): Promise<void> {
    try {
      this.kc = new k8s.KubeConfig()

      if (this.config.kubeconfigPath) {
        const exists = await fs.access(this.config.kubeconfigPath).then(() => true).catch(() => false)
        if (!exists) {
          throw new Error(`Kubeconfig file not found: ${this.config.kubeconfigPath}`)
        }
        this.kc.loadFromFile(this.config.kubeconfigPath)
        logger.info(`Loaded kubeconfig from: ${this.config.kubeconfigPath}`)
      } else {
        this.kc.loadFromDefault()
        logger.info('Loaded kubeconfig from default location')
      }

      this.coreV1Api = this.kc.makeApiClient(k8s.CoreV1Api)
      this.config.enabled = true
      logger.info('Kubernetes client initialized successfully')
    } catch (error) {
      this.config.enabled = false
      logger.error('Failed to initialize Kubernetes client:', error)
      throw error
    }
  }

  async testConnection(): Promise<{ connected: boolean; error?: string; namespace?: string }> {
    try {
      if (!this.kc || !this.coreV1Api) {
        await this.initialize()
      }

      if (!this.coreV1Api) {
        throw new Error('Kubernetes client not initialized after init')
      }

      const namespace = this.config.namespace || 'default'
      await this.coreV1Api.listNamespacedPod({ namespace })

      return { connected: true, namespace }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Kubernetes connection test failed:', error)
      return { connected: false, error: errorMsg }
    }
  }

  async createPod(options: CreatePodOptions): Promise<string> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    const pod: k8s.V1Pod = {
      metadata: {
        name: options.name,
        namespace: options.namespace,
        labels: {
          app: 'opencode-manager',
          'managed-by': 'opencode-manager',
          ...options.labels
        }
      },
      spec: {
        containers: [{
          name: 'runner',
          image: options.image,
          command: options.command,
          args: options.args,
          workingDir: options.workingDir,
          volumeMounts: options.volumeMounts,
          env: options.env ? Object.entries(options.env).map(([name, value]) => ({
            name,
            value
          })) : undefined,
        }],
        volumes: options.volumes,
        restartPolicy: 'Never'
      }
    }

    try {
      const result = await this.coreV1Api.createNamespacedPod({
        namespace: options.namespace,
        body: pod
      })
      logger.info(`Created pod: ${options.name} in namespace: ${options.namespace}`)
      return (result as any).metadata?.name || options.name
    } catch (error) {
      logger.error(`Failed to create pod ${options.name}:`, error)
      throw error
    }
  }

  async deletePod(name: string, namespace: string): Promise<boolean> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      await this.coreV1Api.deleteNamespacedPod({
        name,
        namespace
      })
      logger.info(`Deleted pod: ${name} from namespace: ${namespace}`)
      return true
    } catch (error) {
      logger.error(`Failed to delete pod ${name}:`, error)
      return false
    }
  }

  async getPod(name: string, namespace: string): Promise<k8s.V1Pod | null> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      const result = await this.coreV1Api.readNamespacedPod({
        name,
        namespace
      })
      return (result as any)
    } catch (error) {
      logger.error(`Failed to get pod ${name}:`, error)
      return null
    }
  }

  async listPods(namespace?: string, labelSelector?: string): Promise<PodStatus[]> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    const targetNamespace = namespace || this.config.namespace || 'default'

    try {
      const response = await this.coreV1Api.listNamespacedPod({
        namespace: targetNamespace,
        labelSelector
      })

      const items = (response as any).items || []

      return items.map((pod: k8s.V1Pod) => {
        const status = pod.status
        const phase = status?.phase || 'Unknown'
        const ready = pod.status?.containerStatuses?.every((c: any) => c.ready) ?? false
        const startTime = pod.status?.startTime ? new Date(pod.status.startTime).getTime() : Date.now()
        const age = Date.now() - startTime

        return {
          name: pod.metadata?.name || '',
          namespace: pod.metadata?.namespace || '',
          phase,
          ready,
          age,
          image: pod.spec?.containers?.[0]?.image
        }
      })
    } catch (error) {
      logger.error('Failed to list pods:', error)
      return []
    }
  }

  async execInPod(
    name: string,
    namespace: string,
    command: string[],
    stdoutHandler: (data: string) => void,
    stderrHandler: (data: string) => void
  ): Promise<number> {
    if (!this.kc) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      const exec = new k8s.Exec(this.kc)
      const { Writable } = await import('stream')

      const stdoutStream = new Writable({
        write: (chunk, encoding, callback) => {
          stdoutHandler(chunk.toString())
          callback()
        }
      })

      const stderrStream = new Writable({
        write: (chunk, encoding, callback) => {
          stderrHandler(chunk.toString())
          callback()
        }
      })

      return new Promise((resolve, reject) => {
        exec.exec(
          namespace,
          name,
          'runner',
          command,
          stdoutStream,
          stderrStream,
          null,
          false,
          (status) => {
            const statusCode = (status as any)?.status?.code || 0
            resolve(statusCode)
          }
        )
      })
    } catch (error) {
      logger.error(`Failed to exec in pod ${name}:`, error)
      throw error
    }
  }

  async getPodLogs(name: string, namespace: string, tailLines = 100): Promise<string> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      const result = await this.coreV1Api.readNamespacedPodLog({
        name,
        namespace,
        container: 'runner',
        tailLines
      })

      return (result as any) || ''
    } catch (error) {
      logger.error(`Failed to get logs for pod ${name}:`, error)
      return ''
    }
  }

  async cleanupOldPods(namespace: string, maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      const pods = await this.listPods(namespace, 'managed-by=opencode-manager')
      let deleted = 0

      for (const pod of pods) {
        if (pod.age > maxAgeMs && pod.phase === 'Succeeded') {
          const success = await this.deletePod(pod.name, pod.namespace)
          if (success) deleted++
        }
      }

      if (deleted > 0) {
        logger.info(`Cleaned up ${deleted} old pods in namespace: ${namespace}`)
      }

      return deleted
    } catch (error) {
      logger.error('Failed to cleanup old pods:', error)
      return 0
    }
  }

  async createService(options: CreateServiceOptions): Promise<string> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    const service: k8s.V1Service = {
      metadata: {
        name: options.name,
        namespace: options.namespace,
        labels: {
          'managed-by': 'opencode-manager'
        }
      },
      spec: {
        selector: options.selector,
        type: options.type || 'ClusterIP',
        ports: options.ports.map(p => ({
          name: p.name,
          port: p.port,
          targetPort: p.targetPort || p.port,
          protocol: p.protocol || 'TCP'
        }))
      }
    }

    try {
      const result = await this.coreV1Api.createNamespacedService({
        namespace: options.namespace,
        body: service
      })
      logger.info(`Created service: ${options.name} in namespace: ${options.namespace}`)
      return (result as any).metadata?.name || options.name
    } catch (error) {
      logger.error(`Failed to create service ${options.name}:`, error)
      throw error
    }
  }

  async deleteService(name: string, namespace: string): Promise<boolean> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      await this.coreV1Api.deleteNamespacedService({
        name,
        namespace
      })
      logger.info(`Deleted service: ${name} from namespace: ${namespace}`)
      return true
    } catch (error) {
      logger.error(`Failed to delete service ${name}:`, error)
      return false
    }
  }

  async getService(name: string, namespace: string): Promise<k8s.V1Service | null> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    try {
      const result = await this.coreV1Api.readNamespacedService({
        name,
        namespace
      })
      return (result as any)
    } catch (error) {
      logger.error(`Failed to get service ${name}:`, error)
      return null
    }
  }

  async listServices(namespace?: string, labelSelector?: string): Promise<ServiceStatus[]> {
    if (!this.coreV1Api) {
      throw new Error('Kubernetes client not initialized')
    }

    const targetNamespace = namespace || this.config.namespace || 'default'

    try {
      const response = await this.coreV1Api.listNamespacedService({
        namespace: targetNamespace,
        labelSelector
      })

      const items = (response as any).items || []

      return items.map((service: k8s.V1Service) => {
        const creationTime = service.metadata?.creationTimestamp 
          ? new Date(service.metadata.creationTimestamp).getTime() 
          : Date.now()
        const age = Date.now() - creationTime

        return {
          name: service.metadata?.name || '',
          namespace: service.metadata?.namespace || '',
          type: service.spec?.type || 'ClusterIP',
          clusterIP: service.spec?.clusterIP,
          ports: service.spec?.ports?.map((p: any) => ({
            port: p.port,
            targetPort: p.targetPort,
            protocol: p.protocol || 'TCP'
          })) || [],
          selector: service.spec?.selector || {},
          age
        }
      })
    } catch (error) {
      logger.error('Failed to list services:', error)
      return []
    }
  }

  isEnabled(): boolean {
    return this.config.enabled
  }

  getCurrentNamespace(): string | undefined {
    return this.config.namespace
  }
}

export const kubernetesService = new KubernetesService()
