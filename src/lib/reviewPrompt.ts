/**
 * Compiles inline code comments and PR review comments into a single agent prompt string.
 * Pure function with no side effects.
 *
 * The prompt does NOT include the task's initial prompt — the agent already has
 * that context from the session.
 */

/**
 * `address` — ask the agent to fix the comments.
 * `analyze` — ask the agent to explain the comments without changing code.
 */
export type ReviewPromptMode = 'address' | 'analyze'

export function compileReviewPrompt(
  mode: ReviewPromptMode,
  inlineComments: { path: string; line: number; body: string }[],
  prReviewComments: { body: string; author: string; file_path: string | null; line_number: number | null }[] = []
): string {
  const hasInlineComments = inlineComments.length > 0;
  const hasPrReviewComments = prReviewComments.length > 0;

  // All empty: return empty string
  if (!hasInlineComments && !hasPrReviewComments) {
    return "";
  }

  const sections: string[] = [];
  sections.push(
    mode === 'analyze'
      ? "Please analyze the following review comments and give me your analysis of each — do not change any code yet.\n"
      : "Please address the following review comments:\n"
  );

  // Code Comments section
  if (hasInlineComments) {
    sections.push("## Code Comments");
    inlineComments.forEach((comment, index) => {
      const location = `\`${comment.path}:${comment.line}\``;
      sections.push(`${index + 1}. ${location} — ${comment.body}`);
    });
    sections.push("");
  }

  // PR Review Comments section
  if (hasPrReviewComments) {
    sections.push("## PR Review Comments");
    prReviewComments.forEach((comment, index) => {
      const location = comment.file_path
        ? `\`${comment.file_path}${comment.line_number ? ':' + comment.line_number : ''}\``
        : '(general)';
      sections.push(`${index + 1}. [${comment.author}] ${location} — ${comment.body}`);
    });
    sections.push("");
  }


  // Closing instruction — differs per mode
  if (mode === 'analyze') {
    sections.push("For each comment, explain what it's asking for, whether it's valid and applicable to the current code, and how you would address it.");
    sections.push("Do not modify any code — just provide your analysis so I can decide.");
  } else {
    sections.push("Evaluate each comment for validity against the current code before changing anything.");
    sections.push("Fix the valid ones at the referenced location.");
    sections.push("If a comment is invalid, stale, or already addressed, don't change code for it — explain why.");
  }

  return sections.join("\n");
}
