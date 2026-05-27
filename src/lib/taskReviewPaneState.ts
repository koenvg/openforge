import type { PrFileDiff } from './types';

export interface TaskReviewPaneState {
	selectedCommitSha: string | null;
	diffScrollTop: number;
	reviewedFileShas: Map<string, string>;
}

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
	file: Pick<PrFileDiff, 'filename' | 'sha'>,
): boolean {
	return getTaskReviewPaneState(taskId).reviewedFileShas.get(file.filename) === file.sha;
}

export function markTaskReviewFileReviewed(
	taskId: string,
	file: Pick<PrFileDiff, 'filename' | 'sha'>,
): TaskReviewPaneState {
	const reviewedFileShas = getTaskReviewReviewedFileShas(taskId);
	reviewedFileShas.set(file.filename, file.sha);
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

export function pruneTaskReviewReviewedFiles(taskId: string, files: Pick<PrFileDiff, 'filename' | 'sha'>[]): void {
	const currentFiles = new Map(files.map((file) => [file.filename, file.sha]));
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
