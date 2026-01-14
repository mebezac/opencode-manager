import type { Database } from 'bun:sqlite'
import { executeCommand } from './process'
import { createGitHubCliEnv } from './git-auth'
import type { GitCredential } from './git-auth'

interface GhCliOptions {
  cwd?: string
  silent?: boolean
}

export async function executeGhCommand(
  database: Database,
  args: string[],
  options?: GhCliOptions
): Promise<string> {
  const settingsRow = database.query('SELECT preferences FROM user_preferences WHERE user_id = ?').get('default') as { preferences: string } | null
  
  let gitCredentials: GitCredential[] = []
  if (settingsRow) {
    try {
      const prefs = JSON.parse(settingsRow.preferences)
      gitCredentials = prefs.gitCredentials || []
    } catch {
      gitCredentials = []
    }
  }

  const ghEnv = createGitHubCliEnv(gitCredentials)
  
  return executeCommand(['gh', ...args], {
    cwd: options?.cwd,
    silent: options?.silent,
    env: ghEnv
  })
}
