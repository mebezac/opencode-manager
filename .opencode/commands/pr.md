---
description: Run checks and create a PR
agent: general
---

Create a pull request by following these steps:

1. **Run all PR checks locally:**
   - Install dependencies: !`pnpm install --frozen-lockfile`
   - Type check frontend: !`pnpm --filter frontend typecheck`
   - Lint all code: !`pnpm lint`
   - Build frontend: !`pnpm --filter frontend build`
   - Run backend tests: !`pnpm test`

2. **Verify branch status:**
   - Current branch: !`git branch --show-current`
   - Ensure you're NOT on the main branch
   - If on main, ask the user to switch to a feature branch first

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
- Fix any issues found in step 1 before proceeding
- Use conventional commit format for PR title
- Analyze ALL commits (not just the latest) for the PR summary
- The PR should target the main branch of mebezac/opencode-manager
