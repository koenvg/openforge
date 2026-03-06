# Decisions — mcp-dynamic-titles

## 2026-03-06 Architecture
- MCP server (TypeScript, stdio transport) over CLI or extending OpenCode plugin pattern
- Node.js runtime (users already have it via pnpm requirement)
- Prompt field stored separately, immutable after creation
- Title starts empty, agent generates it progressively
- Task-switching popover DEFERRED — TLDR on card + detail only
- Migrate create_task into MCP server — single tool surface
- Auto-configure both providers on app startup (merge, don't overwrite)
- MCP server location: ~/.config/openforge/mcp-server/
- UI fallback chain: task.title || firstLine(task.prompt) || task.id
