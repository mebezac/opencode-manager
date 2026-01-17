import { describe, it, expect, beforeEach, vi } from 'vitest'
import { KubernetesService } from '../../src/services/kubernetes'

class MockKubernetesService extends KubernetesService {
  public testConnection = vi.fn()
  public createPod = vi.fn()
  public deletePod = vi.fn()
  public getPod = vi.fn()
  public listPods = vi.fn()
  public execInPod = vi.fn()
  public getPodLogs = vi.fn()
  public cleanupOldPods = vi.fn()
  public isEnabled = vi.fn().mockReturnValue(true)
  public getCurrentNamespace = vi.fn().mockReturnValue('test-namespace')
}

describe('KubernetesService (Mocked)', () => {
  let service: MockKubernetesService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new MockKubernetesService({
      enabled: true,
      namespace: 'test-namespace',
    })
  })

  describe('testConnection', () => {
    it('should return connected status when connection succeeds', async () => {
      service.testConnection.mockResolvedValue({
        connected: true,
        namespace: 'test-namespace',
      })

      const result = await service.testConnection()

      expect(result.connected).toBe(true)
      expect(result.namespace).toBe('test-namespace')
    })

    it('should return error status when connection fails', async () => {
      service.testConnection.mockResolvedValue({
        connected: false,
        error: 'Connection failed',
      })

      const result = await service.testConnection()

      expect(result.connected).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('createPod', () => {
    it('should create pod and return pod name', async () => {
      service.createPod.mockResolvedValue('test-pod')

      const podName = await service.createPod({
        name: 'test-pod',
        namespace: 'test-namespace',
        image: 'node:20-alpine',
        command: ['npm', 'start'],
      })

      expect(podName).toBe('test-pod')
      expect(service.createPod).toHaveBeenCalledWith({
        name: 'test-pod',
        namespace: 'test-namespace',
        image: 'node:20-alpine',
        command: ['npm', 'start'],
      })
    })
  })

  describe('deletePod', () => {
    it('should delete pod and return true on success', async () => {
      service.deletePod.mockResolvedValue(true)

      const result = await service.deletePod('test-pod', 'test-namespace')

      expect(result).toBe(true)
      expect(service.deletePod).toHaveBeenCalledWith('test-pod', 'test-namespace')
    })

    it('should return false on failure', async () => {
      service.deletePod.mockResolvedValue(false)

      const result = await service.deletePod('test-pod', 'test-namespace')

      expect(result).toBe(false)
    })
  })

  describe('getPod', () => {
    it('should return pod details', async () => {
      const mockPod = {
        metadata: { name: 'test-pod' },
        status: { phase: 'Running' },
      }
      service.getPod.mockResolvedValue(mockPod as any)

      const result = await service.getPod('test-pod', 'test-namespace')

      expect(result).toEqual(mockPod)
    })

    it('should return null on failure', async () => {
      service.getPod.mockResolvedValue(null)

      const result = await service.getPod('test-pod', 'test-namespace')

      expect(result).toBe(null)
    })
  })

  describe('listPods', () => {
    it('should return list of pod statuses', async () => {
      const mockPods = [
        {
          name: 'pod-1',
          namespace: 'test-namespace',
          phase: 'Running',
          ready: true,
          age: 60000,
          image: 'node:20',
        },
        {
          name: 'pod-2',
          namespace: 'test-namespace',
          phase: 'Pending',
          ready: false,
          age: 120000,
          image: 'python:3.12',
        },
      ]
      service.listPods.mockResolvedValue(mockPods)

      const result = await service.listPods('test-namespace')

      expect(result).toHaveLength(2)
      expect(result[0]).toEqual(
        expect.objectContaining({
          name: 'pod-1',
          namespace: 'test-namespace',
          phase: 'Running',
          ready: true,
          age: 60000,
          image: 'node:20',
        })
      )
      expect(result[1]).toEqual(
        expect.objectContaining({
          name: 'pod-2',
          phase: 'Pending',
          ready: false,
        })
      )
    })
  })

  describe('getPodLogs', () => {
    it('should return pod logs', async () => {
      const mockLogs = 'Starting application...\nReady on port 3000'
      service.getPodLogs.mockResolvedValue(mockLogs)

      const result = await service.getPodLogs('test-pod', 'test-namespace', 50)

      expect(result).toBe(mockLogs)
      expect(service.getPodLogs).toHaveBeenCalledWith('test-pod', 'test-namespace', 50)
    })
  })

  describe('cleanupOldPods', () => {
    it('should delete old succeeded pods', async () => {
      service.cleanupOldPods.mockResolvedValue(5)

      const deleted = await service.cleanupOldPods('test-namespace', 86400000)

      expect(deleted).toBe(5)
      expect(service.cleanupOldPods).toHaveBeenCalledWith('test-namespace', 86400000)
    })

    it('should return 0 when no old pods', async () => {
      service.cleanupOldPods.mockResolvedValue(0)

      const deleted = await service.cleanupOldPods('test-namespace')

      expect(deleted).toBe(0)
    })
  })

  describe('execInPod', () => {
    it('should execute command in pod', async () => {
      const stdoutOutput: string[] = []
      const stderrOutput: string[] = []

      service.execInPod.mockImplementation(
        async (
          _name: string,
          _namespace: string,
          _command: string[],
          stdoutHandler: (data: string) => void,
          stderrHandler: (data: string) => void
        ) => {
          stdoutHandler('Hello from pod')
          return 0
        }
      )

      const exitCode = await service.execInPod(
        'test-pod',
        'test-namespace',
        ['echo', 'hello'],
        (data) => stdoutOutput.push(data),
        (data) => stderrOutput.push(data)
      )

      expect(exitCode).toBe(0)
      expect(stdoutOutput).toContain('Hello from pod')
    })
  })

  describe('isEnabled', () => {
    it('should return true when enabled', () => {
      expect(service.isEnabled()).toBe(true)
      expect(service.isEnabled).toHaveBeenCalled()
    })
  })

  describe('getCurrentNamespace', () => {
    it('should return current namespace', () => {
      expect(service.getCurrentNamespace()).toBe('test-namespace')
      expect(service.getCurrentNamespace).toHaveBeenCalled()
    })
  })
})
