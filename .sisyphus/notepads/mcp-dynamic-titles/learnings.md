# Learnings: MCP Dynamic Titles

## T-512: TLDR Summary Subtitle on Kanban Cards

### What was done
- Added title fallback chain in `TaskCard.svelte`: `task.title || (task.prompt?.split('\n')[0]) || task.id`
- Added summary subtitle below title using `{#if task.summary}` block
- Summary uses daisyUI classes: `text-xs text-base-content/50 truncate`
- Updated test `baseTask` to include `prompt: null` and `summary: null` fields (required by Task interface)

### Key patterns
- Title fallback: use `task.title || (task.prompt?.split('\n')[0]) || task.id` — the optional chaining `?.` handles `prompt: null` safely
- Conditional subtitle: `{#if task.summary}` renders nothing when null — no empty space
- The `firstLine()` helper already existed in the component; the fallback can reuse it inline
- When `task.title` is an empty string `''`, it is falsy in JS, so the fallback chain works correctly

### Test patterns
- Mock tasks must include all fields from the `Task` interface — when types.ts is updated, test fixtures need updating too
- TDD order: update `baseTask` + add new tests → confirm failures → implement → confirm green
