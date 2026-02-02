import * as path from 'path'
import { fileURLToPath } from 'url'
import type { IPCServer, IPCHandler } from './ipcServer'
import type { Database } from 'bun:sqlite'
import { SettingsService } from '../services/settings'
import type { GitCredential } from '../utils/git-auth'
import { logger } from '../utils/logger'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

interface Credentials {
  username: string
  password: string
}

interface AskpassRequest {
  askpassType: 'https' | 'ssh'
  argv: string[]
}

export class AskpassHandler implements IPCHandler {
  private cache = new Map<string, Credentials>()
  private env: Record<string, string>
  private currentRepoUrl: string | null = null
  private preferredCredentialName: string | null = null

  constructor(
    private ipcServer: IPCServer | undefined,
    private database: Database
  ) {
    const scriptsDir = path.join(__dirname, '../../scripts')

    this.env = {
      GIT_ASKPASS: path.join(scriptsDir, this.ipcServer ? 'askpass.sh' : 'askpass-empty.sh'),
      VSCODE_GIT_ASKPASS_NODE: process.execPath,
      VSCODE_GIT_ASKPASS_EXTRA_ARGS: '',
      VSCODE_GIT_ASKPASS_MAIN: path.join(scriptsDir, 'askpass-main.ts'),
    }

    logger.info(`AskpassHandler initialized: execPath=${process.execPath}, GIT_ASKPASS=${this.env.GIT_ASKPASS}, VSCODE_GIT_ASKPASS_NODE=${this.env.VSCODE_GIT_ASKPASS_NODE}, VSCODE_GIT_ASKPASS_MAIN=${this.env.VSCODE_GIT_ASKPASS_MAIN}`)

    if (this.ipcServer) {
      this.ipcServer.registerHandler('askpass', this)
      logger.info('AskpassHandler registered with IPC server')
    } else {
      logger.warn('AskpassHandler: No IPC server provided, using empty askpass')
    }
  }

  setCurrentRepoUrl(repoUrl: string | null): void {
    this.currentRepoUrl = repoUrl
    logger.info(`AskpassHandler: Set current repo URL to ${repoUrl || 'null'}`)
  }

  setPreferredCredentialName(credentialName: string | null): void {
    this.preferredCredentialName = credentialName
    logger.info(`AskpassHandler: Set preferred credential to ${credentialName || 'null'}`)
  }

  async handle(request: AskpassRequest): Promise<string> {
    logger.info(`Askpass request received: type=${request.askpassType}, argv=${JSON.stringify(request.argv)}`)
    if (request.askpassType === 'https') {
      return this.handleHttpsAskpass(request.argv)
    }
    return this.handleSshAskpass()
  }

  private async handleHttpsAskpass(argv: string[]): Promise<string> {
    const request = argv[2] || ''
    const host = argv[4]?.replace(/^["']+|["':]+$/g, '') || ''

    let authority = ''
    try {
      const uri = new URL(host)
      authority = uri.hostname
    } catch {
      authority = host
    }

    const isPassword = /password/i.test(request)

    const cached = this.cache.get(authority)
    if (cached && isPassword) {
      this.cache.delete(authority)
      return cached.password
    }

    const credentials = await this.getCredentialsForHost(authority)
    if (credentials) {
      this.cache.set(authority, credentials)
      setTimeout(() => this.cache.delete(authority), 60_000)
      return isPassword ? credentials.password : credentials.username
    }

    return ''
  }

  private async handleSshAskpass(): Promise<string> {
    return ''
  }

  private async getCredentialsForHost(hostname: string): Promise<Credentials | null> {
    logger.info(`Looking up credentials for host: ${hostname}, currentRepoUrl: ${this.currentRepoUrl || 'none'}, preferredCredential: ${this.preferredCredentialName || 'none'}`)
    const settingsService = new SettingsService(this.database)
    const settings = settingsService.getSettings('default')
    const gitCredentials: GitCredential[] = settings.preferences.gitCredentials || []
    logger.info(`Found ${gitCredentials.length} configured git credentials`)

    if (this.preferredCredentialName) {
      const preferredCred = gitCredentials.find(cred => cred.name === this.preferredCredentialName)
      if (preferredCred) {
        try {
          const parsed = new URL(preferredCred.host)
          if (parsed.hostname.toLowerCase() === hostname.toLowerCase()) {
            logger.info(`Using preferred credential '${this.preferredCredentialName}' for ${hostname}`)
            return {
              username: preferredCred.username || this.getDefaultUsername(preferredCred.host),
              password: preferredCred.token,
            }
          }
        } catch {
          if (preferredCred.host.toLowerCase().includes(hostname.toLowerCase())) {
            logger.info(`Using preferred credential '${this.preferredCredentialName}' for ${hostname}`)
            return {
              username: preferredCred.username || this.getDefaultUsername(preferredCred.host),
              password: preferredCred.token,
            }
          }
        }
        logger.warn(`Preferred credential '${this.preferredCredentialName}' does not match host ${hostname}`)
      } else {
        logger.warn(`Preferred credential '${this.preferredCredentialName}' not found in settings`)
      }
    }

    const matchingCreds: GitCredential[] = []

    for (const cred of gitCredentials) {
      try {
        const parsed = new URL(cred.host)
        if (parsed.hostname.toLowerCase() === hostname.toLowerCase()) {
          matchingCreds.push(cred)
        }
      } catch {
        if (cred.host.toLowerCase().includes(hostname.toLowerCase())) {
          matchingCreds.push(cred)
        }
      }
    }

    if (matchingCreds.length === 0) {
      logger.warn(`No credentials found for host: ${hostname}`)
      return null
    }

    logger.info(`Found ${matchingCreds.length} credential(s) matching ${hostname}`)

    if (matchingCreds.length === 1) {
      const cred = matchingCreds[0]
      logger.info(`Using single matching credential for ${hostname}`)
      return {
        username: cred.username || this.getDefaultUsername(cred.host),
        password: cred.token,
      }
    }

    if (hostname.toLowerCase() === 'github.com' && this.currentRepoUrl) {
      const owner = this.extractOwnerFromUrl(this.currentRepoUrl)
      if (owner) {
        logger.info(`Looking for credential matching owner: ${owner}`)
        const credForOwner = matchingCreds.find(cred => {
          try {
            const parsed = new URL(cred.host)
            const credPath = parsed.pathname.split('/').filter(p => p)[0]
            return credPath?.toLowerCase() === owner.toLowerCase()
          } catch {
            return cred.host.toLowerCase().includes(`/${owner.toLowerCase()}`)
          }
        })
        if (credForOwner) {
          logger.info(`Found credential for owner ${owner}: ${credForOwner.name}`)
          return {
            username: credForOwner.username || this.getDefaultUsername(credForOwner.host),
            password: credForOwner.token,
          }
        }
        logger.warn(`No credential found matching owner ${owner}, falling back to first match`)
      }
    }

    const firstCred = matchingCreds[0]
    logger.info(`Using first matching credential for ${hostname}`)
    return {
      username: firstCred.username || this.getDefaultUsername(firstCred.host),
      password: firstCred.token,
    }
  }

  private extractOwnerFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url)
      if (parsed.hostname.toLowerCase() !== 'github.com') {
        return null
      }

      const pathParts = parsed.pathname.split('/').filter(p => p)
      if (pathParts.length >= 1) {
        return pathParts[0]
      }

      return null
    } catch {
      const sshMatch = url.match(/^git@github\.com:([^/]+)/)
      if (sshMatch) {
        return sshMatch[1]
      }

      const shorthandMatch = url.match(/^([^/]+)\//)
      if (shorthandMatch) {
        return shorthandMatch[1]
      }

      return null
    }
  }

  private extractRepoPathFromUrl(url: string): string | null {
    try {
      const parsed = new URL(url)
      if (parsed.hostname.toLowerCase() !== 'github.com') {
        return null
      }

      const pathParts = parsed.pathname.split('/').filter(p => p)
      if (pathParts.length >= 2) {
        return `${pathParts[0]}/${pathParts[1].replace(/\.git$/, '')}`
      }

      return null
    } catch {
      const sshMatch = url.match(/^git@github\.com:(.+?)(?:\.git)?$/)
      if (sshMatch) {
        return sshMatch[1]
      }

      const shorthandMatch = url.match(/^([^/]+)\/([^/]+)$/)
      if (shorthandMatch) {
        return `${shorthandMatch[1]}/${shorthandMatch[2].replace(/\.git$/, '')}`
      }

      return null
    }
  }

  private getDefaultUsername(host: string): string {
    try {
      const parsed = new URL(host)
      const hostname = parsed.hostname.toLowerCase()

      if (hostname === 'github.com') {
        return 'x-access-token'
      }
      if (hostname === 'gitlab.com' || hostname.includes('gitlab')) {
        return 'oauth2'
      }
      return 'oauth2'
    } catch {
      return 'oauth2'
    }
  }

  getEnv(): Record<string, string> {
    return {
      ...this.env,
      ...(this.ipcServer?.getEnv() || {}),
    }
  }
}
