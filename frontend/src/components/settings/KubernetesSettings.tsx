import { useState } from 'react'
import { useSettings } from '@/hooks/useSettings'
import { Loader2, Check, X, RefreshCw, Trash2, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

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
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'connected' | 'error'>('idle')
  const [testError, setTestError] = useState<string | null>(null)
  const [connectionInfo, setConnectionInfo] = useState<{ namespace: string } | null>(null)
  const [pods, setPods] = useState<PodStatus[]>([])
  const [loadingPods, setLoadingPods] = useState(false)
  const [executingPod, setExecutingPod] = useState<string | null>(null)
  const [execOutput, setExecOutput] = useState<string[]>([])

  const k8sConfig = preferences?.kubernetesConfig || {
    enabled: false,
    namespace: 'opencode-testing',
  }

  const testConnection = async () => {
    setTestStatus('testing')
    setTestError(null)

    try {
      const response = await fetch('/api/kubernetes/test-connection', {
        method: 'POST',
      })

      const result = await response.json()

      if (result.connected) {
        setTestStatus('connected')
        setConnectionInfo({ namespace: result.namespace })
        await loadPods(result.namespace)
      } else {
        setTestStatus('error')
        setTestError(result.error || 'Connection failed')
      }
    } catch (error) {
      setTestStatus('error')
      setTestError(error instanceof Error ? error.message : 'Connection failed')
    }
  }

  const loadPods = async (namespace?: string) => {
    setLoadingPods(true)

    try {
      const ns = namespace || k8sConfig.namespace || 'opencode-testing'
      const response = await fetch(`/api/kubernetes/pods?namespace=${encodeURIComponent(ns)}`)
      const data = await response.json()
      setPods(data.pods || [])
    } finally {
      setLoadingPods(false)
    }
  }

  const deletePod = async (name: string, namespace: string) => {
    try {
      const response = await fetch(`/api/kubernetes/pods/${encodeURIComponent(name)}?namespace=${encodeURIComponent(namespace)}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        await loadPods(namespace)
      }
    } catch {
      // Silently handle error - user will see pods not refreshing
    }
  }

  const execInPod = async (name: string, namespace: string) => {
    setExecutingPod(name)
    setExecOutput([])

    try {
      const response = await fetch(`/api/kubernetes/pods/${encodeURIComponent(name)}/exec`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          namespace,
          command: ['sh', '-c', 'echo "Hello from pod" && hostname && pwd'],
        }),
      })

      const result = await response.json()

      if (result.success) {
        setExecOutput([result.output || '', result.errors || '', `Exit code: ${result.exitCode}`])
      }
    } catch (error) {
      setExecOutput(['Error: ' + (error instanceof Error ? error.message : 'Unknown error')])
    } finally {
      setExecutingPod(null)
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
                <Button onClick={testConnection} disabled={testStatus === 'testing'}>
                  {testStatus === 'testing' && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {testStatus === 'connected' && <Check className="h-4 w-4 mr-2" />}
                  {testStatus === 'error' && <X className="h-4 w-4 mr-2" />}
                  Test Connection
                </Button>
                <Button variant="outline" onClick={() => loadPods()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Refresh Pods
                </Button>
              </div>

              {testStatus === 'connected' && connectionInfo && (
                <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
                  <Check className="h-4 w-4" />
                  Connected to namespace: {connectionInfo.namespace}
                </div>
              )}

              {testStatus === 'error' && testError && (
                <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
                  <X className="h-4 w-4" />
                  {testError}
                </div>
              )}
            </>
          )}
        </div>

        {k8sConfig.enabled && testStatus === 'connected' && (
          <>
            <div className="border-t border-border pt-6">
              <h3 className="text-base font-semibold text-foreground mb-4">Managed Pods</h3>

              {loadingPods ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
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
                                onClick={() => execInPod(pod.name, pod.namespace)}
                                disabled={executingPod === pod.name}
                              >
                                {executingPod === pod.name ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Terminal className="h-4 w-4" />
                                )}
                                Exec
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

                          {executingPod === pod.name && execOutput.length > 0 && (
                            <div className="mt-4 p-3 bg-muted rounded-md">
                              <div className="text-xs text-muted-foreground mb-2">Exec output:</div>
                              <pre className="text-xs text-foreground overflow-x-auto whitespace-pre-wrap">
                                {execOutput.join('\n')}
                              </pre>
                            </div>
                          )}
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
