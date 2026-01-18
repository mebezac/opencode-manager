import { useQuery } from '@tanstack/react-query'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

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
      const response = await fetch(`${API_BASE_URL}/api/health/version`)
      if (!response.ok) {
        throw new Error('Failed to fetch version')
      }
      return response.json()
    },
    staleTime: Infinity,
    gcTime: Infinity,
  })
}
