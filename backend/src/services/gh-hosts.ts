import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import * as yaml from 'js-yaml'
import { logger } from '../utils/logger'
import type { GitCredential } from '../utils/git-auth'

const GH_CONFIG_DIR = '/workspace/.config/gh'
const HOSTS_FILE = join(GH_CONFIG_DIR, 'hosts.yml')

interface GhHostConfig {
  oauth_token: string
  user: string
  users?: Record<string, { oauth_token: string }>
}

interface GhHostsFile {
  [hostname: string]: GhHostConfig
}

export class GhHostsService {
  private ensureConfigDir(): void {
    if (!existsSync(GH_CONFIG_DIR)) {
      mkdirSync(GH_CONFIG_DIR, { recursive: true, mode: 0o700 })
      logger.info(`Created gh config directory: ${GH_CONFIG_DIR}`)
    }
  }

  private extractHostnameFromCredential(credential: GitCredential): string | null {
    try {
      const parsed = new URL(credential.host)
      return parsed.hostname
    } catch {
      if (credential.host.includes('github.com')) {
        return 'github.com'
      }
      return null
    }
  }

  private extractUsernameFromCredential(credential: GitCredential): string | null {
    if (credential.username) {
      return credential.username
    }

    try {
      const parsed = new URL(credential.host)
      const pathParts = parsed.pathname.split('/').filter(p => p)
      if (pathParts.length > 0) {
        return pathParts[0]
      }
    } catch {
      const match = credential.host.match(/github\.com\/([^/]+)/)
      if (match) {
        return match[1]
      }
    }

    return null
  }

  syncCredentialsToHosts(credentials: GitCredential[]): void {
    this.ensureConfigDir()

    const hostsConfig: GhHostsFile = {}

    for (const credential of credentials) {
      const hostname = this.extractHostnameFromCredential(credential)
      if (!hostname) {
        logger.warn(`Skipping credential '${credential.name}': cannot extract hostname from '${credential.host}'`)
        continue
      }

      const username = this.extractUsernameFromCredential(credential)
      if (!username) {
        logger.warn(`Skipping credential '${credential.name}': cannot extract username from '${credential.host}'`)
        continue
      }

      if (!hostsConfig[hostname]) {
        hostsConfig[hostname] = {
          oauth_token: credential.token,
          user: username,
          users: {}
        }
      }

      if (hostsConfig[hostname].users) {
        hostsConfig[hostname].users![username] = {
          oauth_token: credential.token
        }
      }

      if (!hostsConfig[hostname].oauth_token) {
        hostsConfig[hostname].oauth_token = credential.token
        hostsConfig[hostname].user = username
      }

      logger.info(`Synced credential '${credential.name}' for ${username}@${hostname}`)
    }

    if (Object.keys(hostsConfig).length === 0) {
      logger.warn('No valid GitHub credentials to sync to hosts.yml')
      if (existsSync(HOSTS_FILE)) {
        writeFileSync(HOSTS_FILE, '', { mode: 0o600 })
        logger.info('Cleared hosts.yml (no valid credentials)')
      }
      return
    }

    try {
      const yamlContent = yaml.dump(hostsConfig, {
        lineWidth: -1,
        noRefs: true,
        sortKeys: false
      })

      writeFileSync(HOSTS_FILE, yamlContent, { mode: 0o600 })
      logger.info(`Successfully synced ${credentials.length} credential(s) to ${HOSTS_FILE}`)
    } catch (error) {
      logger.error('Failed to write hosts.yml:', error)
      throw new Error(`Failed to sync credentials to gh hosts.yml: ${error}`)
    }
  }

  clearHosts(): void {
    this.ensureConfigDir()

    if (existsSync(HOSTS_FILE)) {
      writeFileSync(HOSTS_FILE, '', { mode: 0o600 })
      logger.info('Cleared gh hosts.yml')
    }
  }

  readHosts(): GhHostsFile | null {
    if (!existsSync(HOSTS_FILE)) {
      return null
    }

    try {
      const content = readFileSync(HOSTS_FILE, 'utf8')
      if (!content.trim()) {
        return {}
      }
      return yaml.load(content) as GhHostsFile
    } catch (error) {
      logger.error('Failed to read hosts.yml:', error)
      return null
    }
  }
}
