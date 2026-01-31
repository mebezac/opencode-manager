---
description: Run checks and create a PR
agent: general
---

Create a pull request by following these steps:

1. **Start on main branch and create feature branch:**
   - Current branch: !`git branch --show-current`
   - **MUST start on main branch** - if you're on a non-main branch:
     - If it seems unrelated to current work, stash changes: !`git stash`
     - Checkout main: !`git checkout main`
     - Pull latest: !`git pull origin main`
     - Create new feature branch: !`git checkout -b feat/descriptive-name`
     - Pop stashed changes: !`git stash pop` (if you stashed)
   - If already on main, create feature branch: !`git checkout -b feat/descriptive-name`

2. **Run all PR checks locally:**
   - Install dependencies: !`pnpm install --frozen-lockfile`
   - Type check frontend: !`pnpm --filter frontend typecheck`
   - Lint all code: !`pnpm lint`
   - Build frontend: !`pnpm --filter frontend build`
   - Run backend tests: !`pnpm test`

3. **Check commit status:**
   - Uncommitted changes: !`git status --short`
   - Commits compared to main: !`git log main..HEAD --oneline`
   - Ensure all changes are committed
   - Verify only relevant commits are present (compare with main)
   - If there are uncommitted changes, ask the user to commit them first

4. **Push and create PR:**
   - Push the current branch: !`git push -u origin HEAD`
   - Create a PR using gh CLI with:
     - Descriptive title based on the commits
     - Detailed body summarizing the changes
     - Target repository: mebezac/opencode-manager (NOT chriswritescode-dev)
   
   Use: `gh pr create --repo mebezac/opencode-manager --title "..." --body "..."`

Important notes:
- Fix any issues found in step 2 before proceeding
- Use conventional commit format for PR title
- Analyze ALL commits (not just the latest) for the PR summary
- The PR should target the main branch of mebezac/opencode-manager
- Never create PRs from main branch directly - always use a feature branch
- If you find yourself on an unrelated branch at the start, it's likely leftover from a previous session
