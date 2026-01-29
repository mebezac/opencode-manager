import { useEffect, useRef, useState } from 'react'
import { init, Terminal } from 'ghostty-web'

interface PodTerminalProps {
  podName: string
  namespace: string
  onClose: () => void
}

export function PodTerminal({ podName, namespace, onClose }: PodTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function initTerminal() {
      if (!containerRef.current) return

      try {
        await init()

        if (!mounted) return

        const term = new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: '#0a0a0a',
            foreground: '#d4d4d4',
            cursor: '#d4d4d4',
          },
          scrollback: 10000,
        })

        terminalRef.current = term
        term.open(containerRef.current)

        const response = await fetch(`/api/kubernetes/exec-ws-url?pod=${encodeURIComponent(podName)}&namespace=${encodeURIComponent(namespace)}`)
        const { wsUrl } = await response.json()

        const ws = new WebSocket(wsUrl)
        wsRef.current = ws

        ws.onopen = () => {
          if (!mounted) return
          setIsConnected(true)
          term.focus()

          const { cols, rows } = term
          ws.send(JSON.stringify({ type: 'resize', cols, rows }))
        }

        ws.onmessage = (event) => {
          if (!mounted) return
          try {
            const data = JSON.parse(event.data)
            if (data.type === 'resize') {
              term.resize(data.cols, data.rows)
            } else if (data.type === 'error') {
              setError(data.message)
            } else if (data.type === 'close') {
              setError('Connection closed by server')
            }
          } catch {
            term.write(event.data)
          }
        }

        ws.onerror = () => {
          if (!mounted) return
          setError('WebSocket connection error')
        }

        ws.onclose = () => {
          if (!mounted) return
          setIsConnected(false)
        }

        term.onData((data) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(data)
          }
        })

        term.onResize(({ cols, rows }) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'resize', cols, rows }))
          }
        })

        term.focus()
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Failed to initialize terminal')
      }
    }

    initTerminal()

    return () => {
      mounted = false
      if (wsRef.current) {
        wsRef.current.close()
      }
      if (terminalRef.current) {
        terminalRef.current.dispose()
      }
    }
  }, [podName, namespace])

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <div className="flex items-center justify-between p-2 bg-muted border-b border-border">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-semibold">{podName}</span>
          <span className="text-xs text-muted-foreground">in {namespace}</span>
          {isConnected ? (
            <span className="text-xs text-green-500">Connected</span>
          ) : (
            <span className="text-xs text-yellow-500">Connecting...</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-xs px-2 py-1 bg-destructive text-destructive-foreground rounded hover:bg-destructive/90"
        >
          Close
        </button>
      </div>
      <div className="bg-black p-2">
        {error ? (
          <div className="text-red-400 text-sm font-mono p-2">
            Error: {error}
          </div>
        ) : (
          <div
            ref={containerRef}
            className="min-h-[300px]"
            style={{ height: '300px' }}
          />
        )}
      </div>
    </div>
  )
}