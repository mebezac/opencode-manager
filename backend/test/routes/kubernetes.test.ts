import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Hono } from 'hono'
import { createKubernetesRoutes } from '../../src/routes/kubernetes'

const {
  mockTestConnection,
  mockCreatePod,
  mockDeletePod,
  mockGetPod,
  mockListPods,
  mockExecInPod,
  mockGetPodLogs,
  mockCleanupOldPods,
  mockIsEnabled,
  mockGetCurrentNamespace,
  mockGetSettings,
  mockUpdateSettings,
} = vi.hoisted(() => ({
  mockTestConnection: vi.fn(),
  mockCreatePod: vi.fn(),
  mockDeletePod: vi.fn(),
  mockGetPod: vi.fn(),
  mockListPods: vi.fn(),
  mockExecInPod: vi.fn(),
  mockGetPodLogs: vi.fn(),
  mockCleanupOldPods: vi.fn(),
  mockIsEnabled: vi.fn().mockReturnValue(true),
  mockGetCurrentNamespace: vi.fn().mockReturnValue('test-namespace'),
  mockGetSettings: vi.fn().mockReturnValue({
    preferences: {
      kubernetesConfig: {
        enabled: true,
        namespace: 'test-namespace',
      },
    },
  }),
  mockUpdateSettings: vi.fn(),
}))

vi.mock('../../src/services/kubernetes', () => ({
  kubernetesService: {
    testConnection: mockTestConnection,
    createPod: mockCreatePod,
    deletePod: mockDeletePod,
    getPod: mockGetPod,
    listPods: mockListPods,
    execInPod: mockExecInPod,
    getPodLogs: mockGetPodLogs,
    cleanupOldPods: mockCleanupOldPods,
    isEnabled: mockIsEnabled,
    getCurrentNamespace: mockGetCurrentNamespace,
  },
}))

vi.mock('../../src/services/settings', () => ({
  SettingsService: class MockSettingsService {
    getSettings = mockGetSettings
    updateSettings = mockUpdateSettings
  },
}))

describe('Kubernetes Routes', () => {
  let app: Hono
  let mockDb: Record<string, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    mockDb = {}
    app = createKubernetesRoutes(mockDb)
  })

  describe('GET /config', () => {
    it('should return Kubernetes config and connection status', async () => {
      mockTestConnection.mockResolvedValue({
        connected: true,
        namespace: 'test-namespace',
      })

      const response = await app.request('/config', {
        method: 'GET',
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data).toHaveProperty('config')
      expect(data).toHaveProperty('connection')
      expect(data.connection.connected).toBe(true)
    })
  })

  describe('PUT /config', () => {
    it('should update Kubernetes config', async () => {
      const response = await app.request('/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled: true,
          namespace: 'new-namespace',
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })
  })

  describe('POST /test-connection', () => {
    it('should test connection and return status', async () => {
      mockTestConnection.mockResolvedValue({
        connected: true,
        namespace: 'test-namespace',
      })

      const response = await app.request('/test-connection', {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.connected).toBe(true)
    })

    it('should return error on connection failure', async () => {
      mockTestConnection.mockResolvedValue({
        connected: false,
        error: 'Connection refused',
      })

      const response = await app.request('/test-connection', {
        method: 'POST',
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.connected).toBe(false)
      expect(data.error).toBeDefined()
    })
  })

  describe('GET /pods', () => {
    it('should return list of pods', async () => {
      const mockPods = [
        {
          name: 'pod-1',
          namespace: 'test-namespace',
          phase: 'Running',
          ready: true,
          age: 60000,
          image: 'node:20',
        },
      ]
      mockListPods.mockResolvedValue(mockPods)

      const response = await app.request(
        '/pods?namespace=test-namespace',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pods).toEqual(mockPods)
    })

    it('should use default namespace if not provided', async () => {
      mockListPods.mockResolvedValue([])

      const response = await app.request('/pods', { method: 'GET' })

      expect(response.status).toBe(200)
      expect(mockListPods).toHaveBeenCalledWith(
        undefined,
        undefined
      )
    })
  })

  describe('GET /pods/:name', () => {
    it('should return pod details', async () => {
      const mockPod = {
        metadata: { name: 'test-pod' },
        status: { phase: 'Running' },
      }
      mockGetPod.mockResolvedValue(mockPod as any)

      const response = await app.request(
        '/pods/test-pod?namespace=test-namespace',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.pod).toEqual(mockPod)
    })

    it('should return 404 if pod not found', async () => {
      mockGetPod.mockResolvedValue(null)

      const response = await app.request(
        '/pods/non-existent?namespace=test-namespace',
        { method: 'GET' }
      )

      expect(response.status).toBe(404)
    })

    it('should return 400 if namespace not provided', async () => {
      const response = await app.request('/pods/test-pod', {
        method: 'GET',
      })

      expect(response.status).toBe(400)
    })
  })

  describe('POST /pods', () => {
    it('should create a new pod', async () => {
      mockCreatePod.mockResolvedValue('test-pod')

      const response = await app.request('/pods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'test-pod',
          namespace: 'test-namespace',
          image: 'node:20-alpine',
          command: ['npm', 'start'],
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.podName).toBe('test-pod')
      expect(mockCreatePod).toHaveBeenCalledWith({
        name: 'test-pod',
        namespace: 'test-namespace',
        image: 'node:20-alpine',
        command: ['npm', 'start'],
      })
    })
  })

  describe('DELETE /pods/:name', () => {
    it('should delete a pod', async () => {
      mockDeletePod.mockResolvedValue(true)

      const response = await app.request('/pods/test-pod', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'test-namespace' }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should return 500 on deletion failure', async () => {
      mockDeletePod.mockResolvedValue(false)

      const response = await app.request('/pods/test-pod', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: 'test-namespace' }),
      })

      expect(response.status).toBe(500)
    })
  })

  describe('GET /pods/:name/logs', () => {
    it('should return pod logs', async () => {
      const mockLogs = 'Starting...\nReady'
      mockGetPodLogs.mockResolvedValue(mockLogs)

      const response = await app.request(
        '/pods/test-pod/logs?namespace=test-namespace&tailLines=50',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.logs).toBe(mockLogs)
    })

    it('should use default tailLines if not provided', async () => {
      mockGetPodLogs.mockResolvedValue('')

      const response = await app.request(
        '/pods/test-pod/logs?namespace=test-namespace',
        { method: 'GET' }
      )

      expect(response.status).toBe(200)
      expect(mockGetPodLogs).toHaveBeenCalledWith(
        'test-pod',
        'test-namespace',
        undefined
      )
    })
  })

  describe('POST /pods/:name/exec', () => {
    it('should execute command in pod', async () => {
      mockExecInPod.mockResolvedValue(0)

      const response = await app.request('/pods/test-pod/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'test-namespace',
          command: ['echo', 'hello'],
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.exitCode).toBe(0)
    })
  })

  describe('POST /cleanup', () => {
    it.skip('should cleanup old pods - routing issue in Hono test setup', async () => {
      const captured: { namespace: string; maxAgeMs: number } = { namespace: '', maxAgeMs: 0 }
      mockCleanupOldPods.mockImplementation(
        async (namespace: string, maxAgeMs?: number) => {
          captured.namespace = namespace
          captured.maxAgeMs = maxAgeMs || 86400000
          return 5
        }
      )

      const response = await app.request('/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          namespace: 'test-namespace',
          maxAgeMs: 86400000,
        }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
      expect(data.deleted).toBe(5)
      expect(captured.namespace).toBe('test-namespace')
      expect(captured.maxAgeMs).toBe(86400000)
    })
  })
})
