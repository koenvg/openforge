#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as z from 'zod/v4';

// Read at invocation time
const HTTP_PORT = process.env.OPENFORGE_HTTP_PORT ?? '17422';
const BASE_URL = `http://127.0.0.1:${HTTP_PORT}`;

const server = new McpServer({
  name: 'openforge',
  version: '1.0.0',
});

server.tool(
  'create_task',
  'Create a new task in Open Forge. Use this when you need to create follow-up work or break a task into subtasks. The task will be added to the backlog.',
  {
    initial_prompt: z.string().describe('Initial instructions or prompt for the task'),
    project_id: z.string().optional().describe('Project ID to associate with (optional, e.g. "P-1")'),
  },
  async ({ initial_prompt, project_id }) => {
    try {
      const res = await fetch(`${BASE_URL}/create_task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ initial_prompt, project_id }),
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to create task: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      return { content: [{ type: 'text', text: `Task created successfully: ${data.task_id}` }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error creating task: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'update_task',
  'Update the initial prompt and/or summary of a task. Call this to set a descriptive initial prompt based on what you\'ve discovered, and a TLDR summary of what you did and what needs attention.',
  {
    task_id: z.string().describe('ID of the task to update (e.g. "T-42")'),
    initial_prompt: z.string().optional().describe('New initial prompt for the task'),
    summary: z.string().optional().describe('TLDR summary of what was done and what needs attention'),
  },
  async ({ task_id, initial_prompt, summary }) => {
    try {
      const res = await fetch(`${BASE_URL}/update_task`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ task_id, initial_prompt, summary }),
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to update task: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      return { content: [{ type: 'text', text: `Task updated successfully: ${data.task_id}` }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error updating task: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'get_task_info',
  'Get current information about a task, including its prompt, initial prompt, and summary.',
  {
    task_id: z.string().describe('ID of the task to retrieve (e.g. "T-42")'),
  },
  async ({ task_id }) => {
    try {
      const res = await fetch(`${BASE_URL}/task/${task_id}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to get task info: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      const lines = [
        `Task: ${data.id}`,
        `Initial Prompt: ${data.initial_prompt}`,
        `Status: ${data.status}`,
        data.prompt ? `Prompt: ${data.prompt}` : null,
        data.summary ? `Summary: ${data.summary}` : null,
        data.jira_key ? `Jira: ${data.jira_key}` : null,
      ].filter(Boolean).join('\n');
      return { content: [{ type: 'text', text: lines }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error getting task info: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'list_tasks',
  'List tasks for a project. Optionally filter by state (backlog, doing, done).',
  {
    project_id: z.string().describe('Project ID to query (e.g. "P-1")'),
    state: z.enum(['backlog', 'doing', 'done']).optional().describe('Optional task state filter'),
  },
  async ({ project_id, state }) => {
    try {
      const params = new URLSearchParams({ project_id });
      if (state) {
        params.set('state', state);
      }

      const res = await fetch(`${BASE_URL}/tasks?${params.toString()}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to list tasks: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text', text: `No tasks found for project ${project_id}${state ? ` in state ${state}` : ''}.` }] };
      }

      const lines = data.map((task) => `${task.id} [${task.status}] ${task.initial_prompt}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error listing tasks: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'get_tasks_by_state',
  'List tasks for a project in a specific state (backlog, doing, done).',
  {
    project_id: z.string().describe('Project ID to query (e.g. "P-1")'),
    state: z.enum(['backlog', 'doing', 'done']).describe('Task state filter'),
  },
  async ({ project_id, state }) => {
    try {
      const params = new URLSearchParams({ project_id, state });
      const res = await fetch(`${BASE_URL}/tasks?${params.toString()}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to get tasks by state: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text', text: `No ${state} tasks found for project ${project_id}.` }] };
      }

      const lines = data.map((task) => `${task.id} [${task.status}] ${task.initial_prompt}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error getting tasks by state: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'get_project_attention',
  'Get attention signals for a project (needs_input, running_agents, ci_failures, unaddressed_comments, completed_agents).',
  {
    project_id: z.string().describe('Project ID to query (e.g. "P-1")'),
  },
  async ({ project_id }) => {
    try {
      const res = await fetch(`${BASE_URL}/project/${project_id}/attention`, {
        method: 'GET',
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to get project attention: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      const lines = [
        `Project: ${data.project_id}`,
        `needs_input: ${data.needs_input}`,
        `running_agents: ${data.running_agents}`,
        `ci_failures: ${data.ci_failures}`,
        `unaddressed_comments: ${data.unaddressed_comments}`,
        `completed_agents: ${data.completed_agents}`,
      ];
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error getting project attention: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'get_work_queue',
  'Get work queue tasks for a project that need developer action/review.',
  {
    project_id: z.string().describe('Project ID to query (e.g. "P-1")'),
  },
  async ({ project_id }) => {
    try {
      const params = new URLSearchParams({ project_id });
      const res = await fetch(`${BASE_URL}/work_queue?${params.toString()}`, {
        method: 'GET',
      });

      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to get work queue: HTTP ${res.status} — ${error}` }] };
      }

      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text', text: `No work queue tasks found for project ${project_id}.` }] };
      }

      const lines = data.map(
        (task) =>
          `${task.id} [${task.status}] ${task.initial_prompt}${task.session_status ? ` (session: ${task.session_status})` : ''}`,
      );
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error getting work queue: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'create_action_item',
  'Create a recommendation or action item for the developer. Use this to surface things that need attention — CI failures, PRs to review, tasks to check. The developer sees these in the app and can dismiss them.',
  {
    project_id: z.string().describe('Project ID to associate with (e.g. "P-1")'),
    title: z.string().describe('Short title for the action item'),
    description: z.string().describe('Detailed description of what needs attention'),
    task_id: z.string().optional().describe('Optional task ID this relates to (e.g. "T-42")'),
  },
  async ({ project_id, title, description, task_id }) => {
    try {
      const res = await fetch(`${BASE_URL}/action_items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id, title, description, task_id }),
      });
      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to create action item: HTTP ${res.status} — ${error}` }] };
      }
      const data = await res.json();
      return { content: [{ type: 'text', text: `Action item created: ${data.id}` }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error creating action item: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'list_action_items',
  'List active (undismissed) action items for a project. Check this before creating new ones to avoid duplicates.',
  {
    project_id: z.string().describe('Project ID to query (e.g. "P-1")'),
  },
  async ({ project_id }) => {
    try {
      const params = new URLSearchParams({ project_id });
      const res = await fetch(`${BASE_URL}/action_items?${params.toString()}`, {
        method: 'GET',
      });
      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to list action items: HTTP ${res.status} — ${error}` }] };
      }
      const data = await res.json();
      if (!Array.isArray(data) || data.length === 0) {
        return { content: [{ type: 'text', text: `No active action items for project ${project_id}.` }] };
      }
      const lines = data.map((item) => `${item.id}: ${item.title} — ${item.description}${item.task_id ? ` (task: ${item.task_id})` : ''}`);
      return { content: [{ type: 'text', text: lines.join('\n') }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error listing action items: ${message}. Is Open Forge running?` }] };
    }
  },
);

server.tool(
  'dismiss_action_item',
  'Dismiss an action item that is no longer relevant. Use the item\'s numeric ID from list_action_items.',
  {
    id: z.number().describe('Numeric ID of the action item to dismiss'),
  },
  async ({ id }) => {
    try {
      const res = await fetch(`${BASE_URL}/action_items/${id}/dismiss`, {
        method: 'POST',
      });
      if (!res.ok) {
        const error = await res.text();
        return { content: [{ type: 'text', text: `Failed to dismiss action item: HTTP ${res.status} — ${error}` }] };
      }
      return { content: [{ type: 'text', text: `Action item ${id} dismissed.` }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return { content: [{ type: 'text', text: `Error dismissing action item: ${message}. Is Open Forge running?` }] };
    }
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Open Forge MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in Open Forge MCP server:', error);
  process.exit(1);
});

export { HTTP_PORT, BASE_URL };
