# Decisions — task-view-terminal

## 2026-03-05 Plan Creation
- Terminal replaces TaskInfoPanel in 30% right column via tab toggle
- Both agent + shell PTYs run simultaneously with different keys
- Shell spawns user's $SHELL in task worktree directory
- PTY key: `{task_id}-shell` for concurrent support
- Shell fallback chain: $SHELL → /bin/zsh → /bin/bash → /bin/sh
- Shell persists on toggle (detach, not kill)
- rightPanelMode resets to 'info' on task change
- Same 256KB ring buffer for shell output
- Tab toggle only in code_view mode, not reviewMode
- PID file: {task_id}-shell.pid
