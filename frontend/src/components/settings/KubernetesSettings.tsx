import { useState, useEffect, useRef } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Loader2, X, Trash2, Terminal, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { PodTerminal } from '@/components/terminal/PodTerminal'

interface PodStatus {
  name: string
  namespace: string
  phase: string
  ready: boolean
  age: number
  image?: string
}

export function KubernetesSettings() {
  const { preferences, isLoading, updateSettings } = useSettings()
  const [pods, setPods] = useState<PodStatus[]>([])
  const [loadingPods, setLoadingPods] = useState(false)
  const [connectionError, setConnectionError] = useState<string | null>(null)
  const [viewingLogs, setViewingLogs] = useState<{ name: string; namespace: string } | null>(null)
  const [logs, setLogs] = useState<string>('')
  const [loadingLogs, setLoadingLogs] = useState(false)
  const logsContainerRef = useRef<HTMLDivElement>(null)
  const [terminalSession, setTerminalSession] = useState<{ name: string; namespace: string } | null>(null)

  const k8sConfig = preferences?.kubernetesConfig || {
    enabled: false,
    namespace: 'opencode-testing',
  }

  const loadPods = async () => {
    setLoadingPods(true)
    setConnectionError(null)
    setPods([])

    try {
      const testResponse = await fetch('/api/kubernetes/test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namespace: k8sConfig.namespace }),
      })

      const testResult = await testResponse.json()

      if (!testResult.connected) {
        setConnectionError(testResult.error || 'Connection failed')
        setLoadingPods(false)
        return
      }

      const response = await fetch(`/api/kubernetes/pods?namespace=${encodeURIComponent(k8sConfig.namespace || 'opencode-testing')}`)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const data = await response.json()
      setPods(data.pods || [])
    } catch (error) {
      setConnectionError(error instanceof Error ? error.message : 'Failed to load pods')
    } finally {
      setLoadingPods(false)
    }
  }

  const viewLogs = async (name: string, namespace: string) => {
    setViewingLogs({ name, namespace })
    setLogs('')
    setLoadingLogs(true)
    await fetchLogs(name, namespace)
  }

  const fetchLogs = async (name: string, namespace: string) => {
    try {
      const response = await fetch(`/api/kubernetes/pods/${encodeURIComponent(name)}/logs?namespace=${encodeURIComponent(namespace)}&tailLines=100`)
      const data = await response.json()
      setLogs(prev => prev === '' ? data.logs || '' : (prev + '\n' + (data.logs || '')).trim())
    } catch {
      setLogs(prev => prev + '\nFailed to fetch logs')
    }
    setLoadingLogs(false)
  }

  const closeLogs = () => {
    setViewingLogs(null)
    setLogs('')
  }

  useEffect(() => {
    if (!viewingLogs) return

    const interval = setInterval(() => {
      fetchLogs(viewingLogs.name, viewingLogs.namespace)
    }, 2000)

    return () => clearInterval(interval)
  }, [viewingLogs])

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight
    }
  }, [logs])

  const deletePod = async (name: string, namespace: string) => {
    try {
      const response = await fetch(`/api/kubernetes/pods/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadPods()
      }
    } catch {
      // Silently handle error - user will see pods not refreshing
    }
  }

  const formatAge = (ms: number) => {
    const seconds = Math.floor(ms / 1000)
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.floor(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}d`
  }

  const getPhaseColor = (phase: string) => {
    switch (phase) {
      case 'Running':
        return 'bg-green-500'
      case 'Pending':
        return 'bg-yellow-500'
      case 'Succeeded':
        return 'bg-blue-500'
      case 'Failed':
        return 'bg-red-500'
      default:
        return 'bg-gray-500'
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-lg font-semibold text-foreground mb-6">Kubernetes Integration</h2>

      <div className="space-y-6">
        <div className="space-y-4">
          <div className="flex flex-row items-center justify-between rounded-lg border border-border p-4">
            <div className="space-y-0.5">
              <Label htmlFor="k8s-enabled" className="text-base">Enable Kubernetes</Label>
              <p className="text-sm text-muted-foreground">
                Enable pod management for isolated testing environments
              </p>
            </div>
            <Switch
              id="k8s-enabled"
              checked={k8sConfig.enabled ?? false}
              onCheckedChange={(checked) => updateSettings({ kubernetesConfig: { ...k8sConfig, enabled: checked } })}
            />
          </div>

          {k8sConfig.enabled && (
            <>
              <div className="space-y-2">
                <Label htmlFor="namespace">Namespace</Label>
                <Input
                  id="namespace"
                  value={k8sConfig.namespace || 'opencode-testing'}
                  onChange={(e) => updateSettings({ kubernetesConfig: { ...k8sConfig, namespace: e.target.value } })}
                  placeholder="opencode-testing"
                  className="max-w-sm"
                />
                <p className="text-sm text-muted-foreground">
                  Kubernetes namespace to use for pod management
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="kubeconfig">Kubeconfig path (optional)</Label>
                <Input
                  id="kubeconfig"
                  value={k8sConfig.kubeconfigPath || ''}
                  onChange={(e) => updateSettings({ kubernetesConfig: { ...k8sConfig, kubeconfigPath: e.target.value } })}
                  placeholder="/workspace/.kube/kubeconfig"
                  className="max-w-sm"
                />
                <p className="text-sm text-muted-foreground">
                  Path to kubeconfig file. Leave empty for default location (/workspace/.kube/kubeconfig)
                </p>
              </div>

              <div className="flex items-center gap-4">
                <Button onClick={loadPods} disabled={loadingPods}>
                  {loadingPods && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Load Pods
                </Button>
              </div>

              {connectionError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <X className="h-4 w-4" />
                  {connectionError}
                </div>
              )}
            </>
          )}
        </div>

        {k8sConfig.enabled && (pods.length > 0 || loadingPods || connectionError) && (
          <>
            <div className="border-t border-border pt-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Managed Pods</h3>

              {loadingPods ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : terminalSession ? (
                <PodTerminal
                  podName={terminalSession.name}
                  namespace={terminalSession.namespace}
                  onClose={() => setTerminalSession(null)}
                />
              ) : viewingLogs ? (
                <div className="border border-border rounded-md">
                  <div className="flex items-center justify-between p-3 bg-muted border-b border-border">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4" />
                      <span className="font-semibold">{viewingLogs.name}</span>
                      <Badge variant="outline" className="text-xs">{viewingLogs.namespace}</Badge>
                    </div>
                    <Button size="sm" variant="outline" onClick={closeLogs}>Close</Button>
                  </div>
                  <div ref={logsContainerRef} className="p-3 bg-black max-h-[400px] overflow-y-auto">
                    {loadingLogs ? (
                      <div className="flex items-center justify-center py-4">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : (
                      <pre className="text-xs text-green-400 whitespace-pre-wrap font-mono">{logs}</pre>
                    )}
                  </div>
                </div>
              ) : pods.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  No pods found. Create pods to test your code in isolated environments.
                </div>
              ) : (
                 <div className="h-[300px] rounded-md border border-border overflow-y-auto">
                   <div className="p-4 space-y-3">
                    {pods.map((pod) => (
                      <Card key={`${pod.namespace}-${pod.name}`} className="border-border">
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-2">
                                <h4 className="font-semibold text-foreground truncate">{pod.name}</h4>
                                <Badge variant="outline" className="text-xs">
                                  {pod.namespace}
                                </Badge>
                              </div>
                              <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                                <span className="flex items-center gap-1">
                                  <div className={`h-2 w-2 rounded-full ${getPhaseColor(pod.phase)}`} />
                                  {pod.phase}
                                </span>
                                <span>•</span>
                                <span>{formatAge(pod.age)}</span>
                                {pod.ready && <Badge variant="outline" className="text-xs">Ready</Badge>}
                              </div>
                              {pod.image && (
                                <p className="text-xs text-muted-foreground truncate">{pod.image}</p>
                              )}
                            </div>

                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => viewLogs(pod.name, pod.namespace)}
                              >
                                <FileText className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setTerminalSession({ name: pod.name, namespace: pod.namespace })}
                              >
                                <Terminal className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => deletePod(pod.name, pod.namespace)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                   </div>
                 </div>
               )}
            </div>

            <div className="flex gap-4 pt-4">
              <Button
                variant="outline"
                onClick={async () => {
                  const response = await fetch('/api/kubernetes/cleanup', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      namespace: k8sConfig.namespace || 'opencode-testing',
                    }),
                  })
                  const result = await response.json()
                  if (result.success) {
                    await loadPods()
                  }
                }}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Cleanup Old Pods
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
