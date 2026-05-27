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

const reviewedFilesStorageKey = 'openforge.taskReviewPaneState.reviewedFiles.v1';

type PersistedReviewedFiles = Record<string, Array<[string, string]>>;

interface ClearTaskReviewPaneStateOptions {
	clearPersisted?: boolean;
}

function cloneTaskReviewPaneState(state: TaskReviewPaneState): TaskReviewPaneState {
	return {
		...state,
		reviewedFileShas: new Map(state.reviewedFileShas),
	};
}

const taskReviewPaneStates = new Map<string, TaskReviewPaneState>();

function getLocalStorage(): Storage | null {
	try {
		return globalThis.localStorage ?? null;
	} catch {
		return null;
	}
}

function normalizePersistedReviewedFiles(value: unknown): PersistedReviewedFiles {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	const persisted = Object.create(null) as PersistedReviewedFiles;
	for (const [taskId, entries] of Object.entries(value)) {
		if (!Array.isArray(entries)) continue;
		const normalizedEntries = entries.filter((entry): entry is [string, string] => (
			Array.isArray(entry)
			&& entry.length === 2
			&& typeof entry[0] === 'string'
			&& typeof entry[1] === 'string'
		));
		if (normalizedEntries.length > 0) {
			persisted[taskId] = normalizedEntries;
		}
	}
	return persisted;
}

function readPersistedReviewedFiles(): PersistedReviewedFiles {
	const storage = getLocalStorage();
	if (storage === null) return {};

	try {
		const rawValue = storage.getItem(reviewedFilesStorageKey);
		if (rawValue === null) return {};
		return normalizePersistedReviewedFiles(JSON.parse(rawValue));
	} catch {
		return {};
	}
}

function readPersistedTaskReviewedFileShas(taskId: string): Map<string, string> {
	return new Map(readPersistedReviewedFiles()[taskId] ?? []);
}

function writePersistedReviewedFiles(persisted: PersistedReviewedFiles): void {
	const storage = getLocalStorage();
	if (storage === null) return;

	try {
		if (Object.keys(persisted).length === 0) {
			storage.removeItem(reviewedFilesStorageKey);
			return;
		}
		storage.setItem(reviewedFilesStorageKey, JSON.stringify(persisted));
	} catch {
		// Persistence should not block the review UI when storage is unavailable or full.
	}
}

function writePersistedTaskReviewedFileShas(taskId: string, reviewedFileShas: Map<string, string>): void {
	const persisted = readPersistedReviewedFiles();
	if (reviewedFileShas.size === 0) {
		delete persisted[taskId];
	} else {
		persisted[taskId] = Array.from(reviewedFileShas.entries());
	}
	writePersistedReviewedFiles(persisted);
}

function clearPersistedTaskReviewReviewedFiles(taskId?: string): void {
	if (taskId === undefined) {
		writePersistedReviewedFiles(Object.create(null) as PersistedReviewedFiles);
		return;
	}

	const persisted = readPersistedReviewedFiles();
	delete persisted[taskId];
	writePersistedReviewedFiles(persisted);
}

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
	const existing = taskReviewPaneStates.get(taskId);
	if (existing !== undefined) return existing;

	const hydrated = {
		...cloneTaskReviewPaneState(defaultTaskReviewPaneState),
		reviewedFileShas: readPersistedTaskReviewedFileShas(taskId),
	};
	taskReviewPaneStates.set(taskId, hydrated);
	return hydrated;
}

export function updateTaskReviewPaneState(
	taskId: string,
	patch: Partial<TaskReviewPaneState>,
): TaskReviewPaneState {
	const current = getTaskReviewPaneState(taskId);
	const next = {
		...current,
		...patch,
		reviewedFileShas: patch.reviewedFileShas !== undefined
			? new Map(patch.reviewedFileShas)
			: new Map(current.reviewedFileShas),
	};
	taskReviewPaneStates.set(taskId, next);
	if (patch.reviewedFileShas !== undefined) {
		writePersistedTaskReviewedFileShas(taskId, next.reviewedFileShas);
	}
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

export function clearTaskReviewPaneState(
	taskId?: string,
	options: ClearTaskReviewPaneStateOptions = {},
): void {
	const clearPersisted = options.clearPersisted ?? true;
	if (taskId !== undefined) {
		taskReviewPaneStates.delete(taskId);
		if (clearPersisted) {
			clearPersistedTaskReviewReviewedFiles(taskId);
		}
		return;
	}
	taskReviewPaneStates.clear();
	if (clearPersisted) {
		clearPersistedTaskReviewReviewedFiles();
	}
}
