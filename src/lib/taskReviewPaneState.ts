import type { PrFileDiff } from './types';

export interface TaskReviewPaneState {
	selectedCommitSha: string | null;
	diffScrollTop: number;
	reviewedFileShas: Map<string, string>;
}

type TaskReviewFileIdentityInput = Pick<
	PrFileDiff,
	| 'filename'
	| 'sha'
	| 'status'
	| 'additions'
	| 'deletions'
	| 'changes'
	| 'patch'
	| 'previous_filename'
	| 'is_truncated'
	| 'patch_line_count'
>;

const defaultTaskReviewPaneState: TaskReviewPaneState = {
	selectedCommitSha: null,
	diffScrollTop: 0,
	reviewedFileShas: new Map(),
};

function cloneTaskReviewPaneState(state: TaskReviewPaneState): TaskReviewPaneState {
	return {
		...state,
		reviewedFileShas: new Map(state.reviewedFileShas),
	};
}

const taskReviewPaneStates = new Map<string, TaskReviewPaneState>();

function hashString(value: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < value.length; i += 1) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, '0');
}

export function getTaskReviewFileIdentity(file: TaskReviewFileIdentityInput): string | null {
	const sha = file.sha.trim();
	if (sha.length > 0) return sha;

	if (file.patch === null || file.is_truncated) return null;

	const contentIdentity = JSON.stringify({
		status: file.status,
		previousFilename: file.previous_filename,
		additions: file.additions,
		deletions: file.deletions,
		changes: file.changes,
		patch: file.patch,
		isTruncated: file.is_truncated,
		patchLineCount: file.patch_line_count,
	});
	return `diff:${contentIdentity.length}:${hashString(contentIdentity)}`;
}

export function getTaskReviewPaneState(taskId: string): TaskReviewPaneState {
	return taskReviewPaneStates.get(taskId) ?? cloneTaskReviewPaneState(defaultTaskReviewPaneState);
}

export function updateTaskReviewPaneState(
	taskId: string,
	patch: Partial<TaskReviewPaneState>,
): TaskReviewPaneState {
	const current = getTaskReviewPaneState(taskId);
	const next = {
		...current,
		...patch,
		reviewedFileShas: patch.reviewedFileShas
			? new Map(patch.reviewedFileShas)
			: new Map(current.reviewedFileShas),
	};
	taskReviewPaneStates.set(taskId, next);
	return next;
}

export function getTaskReviewReviewedFileShas(taskId: string): Map<string, string> {
	return new Map(getTaskReviewPaneState(taskId).reviewedFileShas);
}

export function isTaskReviewFileReviewed(
	taskId: string,
	file: TaskReviewFileIdentityInput,
): boolean {
	const identity = getTaskReviewFileIdentity(file);
	return identity !== null && getTaskReviewPaneState(taskId).reviewedFileShas.get(file.filename) === identity;
}

export function markTaskReviewFileReviewed(
	taskId: string,
	file: TaskReviewFileIdentityInput,
): TaskReviewPaneState {
	const reviewedFileShas = getTaskReviewReviewedFileShas(taskId);
	const identity = getTaskReviewFileIdentity(file);
	if (identity === null) {
		reviewedFileShas.delete(file.filename);
	} else {
		reviewedFileShas.set(file.filename, identity);
	}
	return updateTaskReviewPaneState(taskId, { reviewedFileShas });
}

export function unmarkTaskReviewFileReviewed(
	taskId: string,
	filename: string,
): TaskReviewPaneState {
	const reviewedFileShas = getTaskReviewReviewedFileShas(taskId);
	reviewedFileShas.delete(filename);
	return updateTaskReviewPaneState(taskId, { reviewedFileShas });
}

export function pruneTaskReviewReviewedFiles(taskId: string, files: TaskReviewFileIdentityInput[]): void {
	const currentFiles = new Map(
		files
			.map((file): [string, string | null] => [file.filename, getTaskReviewFileIdentity(file)])
			.filter((entry): entry is [string, string] => entry[1] !== null),
	);
	const reviewedFileShas = getTaskReviewReviewedFileShas(taskId);
	let changed = false;

	for (const [filename, sha] of reviewedFileShas.entries()) {
		if (currentFiles.get(filename) !== sha) {
			reviewedFileShas.delete(filename);
			changed = true;
		}
	}

	if (changed) {
		updateTaskReviewPaneState(taskId, { reviewedFileShas });
	}
}

export function clearTaskReviewPaneState(taskId?: string): void {
	if (taskId !== undefined) {
		taskReviewPaneStates.delete(taskId);
		return;
	}
	taskReviewPaneStates.clear();
}
