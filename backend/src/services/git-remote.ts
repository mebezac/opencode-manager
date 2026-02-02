import { executeCommand } from '../utils/process'
import { logger } from '../utils/logger'
import type { GitCredential } from '../utils/git-auth'

export interface GitRemoteInfo {
  name: string
  url: string
  type: 'fetch' | 'push'
}

export async function getGitRemotes(repoPath: string): Promise<GitRemoteInfo[]> {
  try {
    const output = await executeCommand(['git', '-C', repoPath, 'remote', '-v'], { silent: true })
    const lines = output.trim().split('\n').filter(line => line.trim())
    
    return lines.map(line => {
      const [name, rest] = line.split(/\s+/)
      const urlMatch = rest.match(/(.+?)\s+\((fetch|push)\)/)
      if (!urlMatch) {
        throw new Error(`Invalid git remote format: ${line}`)
      }
      return {
        name,
        url: urlMatch[1],
        type: urlMatch[2] as 'fetch' | 'push'
      }
    })
  } catch (error) {
    logger.error(`Failed to get git remotes for ${repoPath}:`, error)
    throw error
  }
}

export function embedCredentialInUrl(url: string, credential: GitCredential): string {
  try {
    const parsed = new URL(url)
    
    if (parsed.protocol !== 'https:') {
      logger.warn(`Cannot embed credential in non-HTTPS URL: ${url}`)
      return url
    }
    
    const username = credential.username || 'x-access-token'
    parsed.username = username
    parsed.password = credential.token
    
    return parsed.toString()
  } catch (error) {
    logger.error(`Failed to parse URL: ${url}`, error)
    throw new Error(`Invalid git URL: ${url}`)
  }
}

export function stripCredentialFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch (error) {
    logger.error(`Failed to parse URL: ${url}`, error)
    return url
  }
}

export async function updateGitRemoteWithCredential(
  repoPath: string,
  remoteName: string,
  credential: GitCredential
): Promise<void> {
  try {
    const remotes = await getGitRemotes(repoPath)
    const remote = remotes.find(r => r.name === remoteName && r.type === 'fetch')
    
    if (!remote) {
      throw new Error(`Remote '${remoteName}' not found in repository`)
    }
    
    const strippedUrl = stripCredentialFromUrl(remote.url)
    const urlWithCredential = embedCredentialInUrl(strippedUrl, credential)
    
    await executeCommand(['git', '-C', repoPath, 'remote', 'set-url', remoteName, urlWithCredential], { silent: true })
    
    logger.info(`Updated git remote '${remoteName}' with embedded credential for ${repoPath}`)
  } catch (error) {
    logger.error(`Failed to update git remote for ${repoPath}:`, error)
    throw error
  }
}

export async function removeCredentialFromGitRemote(
  repoPath: string,
  remoteName: string
): Promise<void> {
  try {
    const remotes = await getGitRemotes(repoPath)
    const remote = remotes.find(r => r.name === remoteName && r.type === 'fetch')
    
    if (!remote) {
      throw new Error(`Remote '${remoteName}' not found in repository`)
    }
    
    const strippedUrl = stripCredentialFromUrl(remote.url)
    
    if (strippedUrl === remote.url) {
      logger.info(`Remote '${remoteName}' already has no embedded credential`)
      return
    }
    
    await executeCommand(['git', '-C', repoPath, 'remote', 'set-url', remoteName, strippedUrl], { silent: true })
    
    logger.info(`Removed embedded credential from git remote '${remoteName}' for ${repoPath}`)
  } catch (error) {
    logger.error(`Failed to remove credential from git remote for ${repoPath}:`, error)
    throw error
  }
}

export function hasEmbeddedCredential(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.username !== '' || parsed.password !== ''
  } catch {
    return false
  }
}
