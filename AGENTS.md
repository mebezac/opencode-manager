# OpenCode WebUI - Agent Guidelines

NOTE: this is a fork, but it is a standalone project. When asked to make a pull request (or pr) 
make the pull request against this (mebezac) repo NOT the original (chriswritescode-dev) repo it was forked from

## Git Workflow

### Branch Management
At the beginning of a conversation, if we're not on the main branch:
- Check the current branch with `git branch --show-current`
- Ask the user if we should create a new branch for the work
- Suggest a descriptive branch name based on the task (e.g., `feat/add-settings-page`, `fix/database-connection`)

**Creating new branches:**
- ALWAYS base new branches off `main`
- Before creating a new branch, ensure you're on `main` by running `git checkout main`
- If currently on a different branch, switch to `main` first before creating the new branch

### Conventional Commits
All commits MUST follow the Conventional Commits specification:

Format: `<type>(<scope>): <description>`

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, missing semicolons, etc.)
- `refactor:` - Code refactoring without feature changes or bug fixes
- `perf:` - Performance improvements
- `test:` - Adding or updating tests
- `build:` - Build system or dependency changes
- `ci:` - CI/CD configuration changes
- `chore:` - Other changes that don't modify src or test files

**Scope (optional):** Component or area affected (e.g., `backend`, `frontend`, `api`, `ui`)

**Examples:**
- `feat(backend): add user authentication endpoint`
- `fix(frontend): resolve infinite loop in conversation list`
- `docs: update installation instructions`
- `refactor(api): simplify error handling middleware`

### GitHub CLI Integration
Use the `gh` command via the Bash tool for ALL GitHub-related tasks including working with issues, pull requests, checks, and releases. If given a Github URL use the gh command to get the information needed.

**Common scenarios:**
- Reading a PR: `gh pr view <number>` or `gh pr view <url>`
- Checking CI status: `gh pr checks <number>`
- Viewing CI logs: `gh run view <run-id> --log` or `gh run view <run-id> --log-failed`
- Reading issues: `gh issue view <number>`
- Creating PRs: `gh pr create --title "..." --body "..."`
- Listing PRs: `gh pr list`

**Important:**
- NEVER use WebFetch or other tools for GitHub URLs
- Always parse GitHub URLs to extract relevant information (repo, PR number, issue number, etc.)
- Use `gh api` for advanced queries not covered by standard commands

## Commands

- `pnpm dev` - Start both backend (5001) and frontend (5173)
- `pnpm dev:backend` - Backend only: `bun --watch backend/src/index.ts`
- `pnpm dev:frontend` - Frontend only: `cd frontend && vite`
- `pnpm build` - Build both backend and frontend
- `pnpm test` - Run backend tests: `cd backend && bun test`
- `cd backend && bun test <filename>` - Run single test file
- `cd backend && vitest --ui` - Test UI with coverage
- `cd backend && vitest --coverage` - Coverage report (80% threshold)
- `pnpm lint` - Lint both backend and frontend
- `pnpm lint:backend` - Backend linting
- `pnpm lint:frontend` - Frontend linting

## Code Style

- No comments, self-documenting code only
- No console logs (use Bun's logger or proper error handling)
- Strict TypeScript everywhere, proper typing required
- Named imports only: `import { Hono } from 'hono'`, `import { useState } from 'react'`

### Backend (Bun + Hono)

- Hono framework with Zod validation, Better SQLite3 database
- Error handling with try/catch and structured logging
- Follow existing route/service/utility structure
- Use async/await consistently, avoid .then() chains
- Test coverage: 80% minimum required

### Frontend (React + Vite)

- @/ alias for components: `import { Button } from '@/components/ui/button'`
- Radix UI + Tailwind CSS, React Hook Form + Zod
- React Query (@tanstack/react-query) for state management
- ESLint TypeScript rules enforced
- Use React hooks properly, no direct state mutations

### General

- DRY principles, follow existing patterns
- ./temp/opencode is reference only, never commit has opencode src
- Use shared types from workspace package (@opencode-manager/shared)
- OpenCode server runs on port 5551, backend API on port 5001
- Prefer pnpm over npm for all package management
- Run `pnpm lint` after completing tasks to ensure code quality

## Multiple Git Credentials (PATs)

OpenCode Manager supports using multiple GitHub Personal Access Tokens (PATs) for different repositories. This is useful when you work with repos from different GitHub organizations that require different access tokens.

### How it works

The system uses Git's `credential.useHttpPath` configuration to match credentials based on the full repository URL path, not just the hostname. This means you can configure separate PATs for different GitHub users or organizations.

**Automatic synchronization:**
- Git credentials are automatically synced to `~/.config/gh/hosts.yml` for GitHub CLI
- Syncing happens on app startup and whenever credentials are updated
- No manual configuration or redeployment required
- Both git operations and gh CLI commands use the correct tokens automatically

### Configuration

In Settings > Git Credentials, add multiple credentials with path-based hosts:

**Example: Personal + Work setup**

1. **Personal PAT**
   - Name: `Personal`
   - Host: `https://github.com/your-username`
   - Token: `ghp_xxx...`

2. **Work Organization PAT**
   - Name: `Work`
   - Host: `https://github.com/your-company`
   - Token: `ghp_yyy...`

**Matching behavior:**
- Repos under `https://github.com/your-username/*` → Uses Personal PAT
- Repos under `https://github.com/your-company/*` → Uses Work PAT
- Each repo automatically gets the correct credential based on its URL path
- GitHub CLI (`gh`) commands respect the same credential mapping

### Per-repo credential selection

You can also override the automatic selection for specific repositories:

1. Go to the repository in OpenCode Manager
2. Click "Change Credential" 
3. Select a specific credential for that repo

This is useful when you have multiple PATs for the same organization and need to assign specific repos to specific tokens.

## Release Process

When creating a new release:
1. Update the version in `package.json`
2. The version will be automatically displayed in the Settings page
3. For Docker images, the version is read from package.json at build time

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd sync
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
