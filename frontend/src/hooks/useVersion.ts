import { useQuery } from '@tanstack/react-query'
import { API_BASE_URL } from '@/config'

interface VersionInfo {
  version: string
  opencodeVersion: string | null
  opencodeMinVersion: string | null
  opencodeVersionSupported: boolean
}

export function useVersion() {
  return useQuery<VersionInfo>({
    queryKey: ['version'],
    queryFn: async () => {
      const url = `${API_BASE_URL}/api/health/version`
      
      const response = await fetch(url)
      
      if (!response.ok) {
        console.error('[useVersion] Failed to fetch version:', response.status, response.statusText)
        throw new Error('Failed to fetch version')
      }
      
      return response.json()
    },
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 3,
    retryDelay: 1000,
  })
}
