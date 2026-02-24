import { describe, it, expect } from 'vitest'

import { parsePromptToParts } from './promptParser'

describe('parsePromptToParts', () => {
  it('parses file mention into file part', () => {
    const fileMap = new Map([
      ['values.yaml', { path: '/workspace/kubernetes/apps/n8n/values.yaml', name: 'values.yaml' }]
    ])

    const parts = parsePromptToParts('check @values.yaml', fileMap, undefined, ['summary'])

    expect(parts).toEqual([
      { type: 'text', content: 'check ' },
      { type: 'file', path: '/workspace/kubernetes/apps/n8n/values.yaml', name: 'values.yaml' }
    ])
  })

  it('keeps file mention behavior when agent mentions also exist', () => {
    const fileMap = new Map([
      ['kustomization.yaml', { path: '/workspace/kubernetes/apps/n8n/kustomization.yaml', name: 'kustomization.yaml' }]
    ])

    const parts = parsePromptToParts('@summary inspect @kustomization.yaml', fileMap, undefined, ['summary'])

    expect(parts).toEqual([
      { type: 'agent', name: 'summary' },
      { type: 'text', content: ' inspect ' },
      { type: 'file', path: '/workspace/kubernetes/apps/n8n/kustomization.yaml', name: 'kustomization.yaml' }
    ])
  })
})
