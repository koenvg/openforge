<script lang="ts">
  import type { AgentSession } from '../lib/types'
  import { approveCheckpoint, rejectCheckpoint } from '../lib/ipc'

  export let session: AgentSession

  let feedback = ''
  let isSubmitting = false

  function stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      read_ticket: 'After Reading Ticket',
      implement: 'After Implementation',
      create_pr: 'After PR Creation',
      address_comments: 'After Addressing Comments',
    }
    return labels[stage] || stage
  }

  async function handleApprove() {
    isSubmitting = true
    try {
      await approveCheckpoint(session.id)
    } catch (e) {
      console.error('Failed to approve:', e)
    } finally {
      isSubmitting = false
    }
  }

  async function handleReject() {
    if (!feedback.trim()) return
    isSubmitting = true
    try {
      await rejectCheckpoint(session.id, feedback)
      feedback = ''
    } catch (e) {
      console.error('Failed to reject:', e)
    } finally {
      isSubmitting = false
    }
  }
</script>

{#if session.status === 'paused' && session.checkpoint_data}
  <div class="checkpoint">
    <div class="checkpoint-header">
      Checkpoint: {stageLabel(session.stage)}
    </div>
    <div class="checkpoint-body">
      <pre class="checkpoint-data">{session.checkpoint_data}</pre>
    </div>
    <div class="checkpoint-actions">
      <button class="btn btn-approve" on:click={handleApprove} disabled={isSubmitting}>
        Approve
      </button>
      <div class="reject-group">
        <input
          type="text"
          class="feedback-input"
          placeholder="Feedback for rejection..."
          bind:value={feedback}
        />
        <button class="btn btn-reject" on:click={handleReject} disabled={isSubmitting || !feedback.trim()}>
          Reject
        </button>
      </div>
    </div>
  </div>
{:else if session.status === 'running'}
  <div class="status-message running">Agent is working...</div>
{:else if session.status === 'completed'}
  <div class="status-message completed">Stage completed</div>
{:else if session.status === 'failed'}
  <div class="status-message failed">{session.error_message || 'An error occurred'}</div>
{/if}

<style>
  .checkpoint {
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .checkpoint-header {
    padding: 10px 14px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--warning);
  }

  .checkpoint-body {
    padding: 12px 14px;
    max-height: 300px;
    overflow-y: auto;
  }

  .checkpoint-data {
    margin: 0;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.75rem;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
    line-height: 1.5;
  }

  .checkpoint-actions {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 10px 14px;
    border-top: 1px solid var(--border);
    background: var(--bg-secondary);
  }

  .reject-group {
    display: flex;
    gap: 6px;
    flex: 1;
  }

  .feedback-input {
    flex: 1;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 10px;
    color: var(--text-primary);
    font-size: 0.75rem;
    outline: none;
  }

  .feedback-input:focus {
    border-color: var(--accent);
  }

  .btn {
    padding: 6px 14px;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-approve {
    background: var(--success);
    color: var(--bg-primary);
  }

  .btn-reject {
    background: var(--error);
    color: white;
  }

  .status-message {
    padding: 20px;
    text-align: center;
    font-size: 0.8rem;
    border-radius: 6px;
  }

  .running { color: var(--success); }
  .completed { color: var(--accent); }
  .failed { color: var(--error); }
</style>
