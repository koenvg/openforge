import { getReviewFileIdentity, type ReviewFileIdentityInput } from '@openforge/pr-review-ui/reviewFileIdentity';
import type { PrFileDiff } from './types';

export interface TaskReviewPaneState {
	selectedCommitSha: string | null;
	diffScrollTop: number;
	reviewedFileShas: Map<string, string>;
}

export interface ReviewedFileSnapshot {
	identity: string;
	newContent: string;
}

type TaskReviewFileIdentityInput = Pick<PrFileDiff, keyof ReviewFileIdentityInput>;

const defaultTaskReviewPaneState: TaskReviewPaneState = {
	selectedCommitSha: null,
	diffScrollTop: 0,
	reviewedFileShas: new Map(),
};

const reviewedFilesStorageKey = 'openforge.taskReviewPaneState.reviewedFiles.v1';
const reviewedFileSnapshotsStorageKey = 'openforge.taskReviewPaneState.reviewedFileSnapshots.v1';
const reviewedFileSnapshotMaxContentLength = 256 * 1024;
const reviewedFileSnapshotsMaxSerializedLength = 1024 * 1024;

type PersistedReviewedFiles = Record<string, Array<[string, string]>>;
type PersistedReviewedFileSnapshots = Record<string, Array<[string, ReviewedFileSnapshot]>>;

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

function isReviewedFileSnapshotWithinPerFileCap(snapshot: ReviewedFileSnapshot): boolean {
	return snapshot.newContent.length <= reviewedFileSnapshotMaxContentLength;
}

function normalizePersistedReviewedFileSnapshots(value: unknown): PersistedReviewedFileSnapshots {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return {};
	}

	const persisted = Object.create(null) as PersistedReviewedFileSnapshots;
	for (const [taskId, entries] of Object.entries(value)) {
		if (!Array.isArray(entries)) continue;
		const normalizedEntries = entries.filter((entry): entry is [string, ReviewedFileSnapshot] => {
			if (
				!Array.isArray(entry)
				|| entry.length !== 2
				|| typeof entry[0] !== 'string'
				|| entry[1] === null
				|| typeof entry[1] !== 'object'
				|| typeof (entry[1] as ReviewedFileSnapshot).identity !== 'string'
				|| typeof (entry[1] as ReviewedFileSnapshot).newContent !== 'string'
			) {
				return false;
			}
			return isReviewedFileSnapshotWithinPerFileCap(entry[1] as ReviewedFileSnapshot);
		});
		if (normalizedEntries.length > 0) {
			persisted[taskId] = normalizedEntries;
		}
	}
	return prunePersistedReviewedFileSnapshots(persisted);
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

function readPersistedReviewedFileSnapshots(): PersistedReviewedFileSnapshots {
	const storage = getLocalStorage();
	if (storage === null) return {};

	try {
		const rawValue = storage.getItem(reviewedFileSnapshotsStorageKey);
		if (rawValue === null) return {};
		return normalizePersistedReviewedFileSnapshots(JSON.parse(rawValue));
	} catch {
		return {};
	}
}

function readPersistedTaskReviewedFileShas(taskId: string): Map<string, string> {
	return new Map(readPersistedReviewedFiles()[taskId] ?? []);
}

function readPersistedTaskReviewedFileSnapshots(taskId: string): Map<string, ReviewedFileSnapshot> {
	return new Map(readPersistedReviewedFileSnapshots()[taskId] ?? []);
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

function compareStorageKeys(left: string, right: string): number {
	if (left < right) return -1;
	if (left > right) return 1;
	return 0;
}

function comparePreferredTask(leftTaskId: string, rightTaskId: string, preferredTaskId?: string): number {
	if (preferredTaskId === undefined) return 0;
	if (leftTaskId === preferredTaskId && rightTaskId !== preferredTaskId) return -1;
	if (rightTaskId === preferredTaskId && leftTaskId !== preferredTaskId) return 1;
	return 0;
}

function prunePersistedReviewedFileSnapshots(
	persisted: PersistedReviewedFileSnapshots,
	preferredTaskId?: string,
): PersistedReviewedFileSnapshots {
	const entries = Object.entries(persisted)
		.flatMap(([taskId, snapshots]) => snapshots.map(([filename, snapshot]) => ({ taskId, filename, snapshot })))
		.filter(({ snapshot }) => isReviewedFileSnapshotWithinPerFileCap(snapshot))
		.sort((left, right) => (
			comparePreferredTask(left.taskId, right.taskId, preferredTaskId)
			|| compareStorageKeys(left.taskId, right.taskId)
			|| compareStorageKeys(left.filename, right.filename)
		));
	const pruned = Object.create(null) as PersistedReviewedFileSnapshots;

	for (const { taskId, filename, snapshot } of entries) {
		const existingTaskEntries = pruned[taskId] ?? [];
		pruned[taskId] = [...existingTaskEntries, [filename, snapshot]];
		if (JSON.stringify(pruned).length > reviewedFileSnapshotsMaxSerializedLength) {
			if (existingTaskEntries.length === 0) {
				delete pruned[taskId];
			} else {
				pruned[taskId] = existingTaskEntries;
			}
		}
	}

	return pruned;
}

function writePersistedReviewedFileSnapshots(persisted: PersistedReviewedFileSnapshots, preferredTaskId?: string): void {
	const storage = getLocalStorage();
	if (storage === null) return;

	try {
		const boundedPersisted = prunePersistedReviewedFileSnapshots(persisted, preferredTaskId);
		if (Object.keys(boundedPersisted).length === 0) {
			storage.removeItem(reviewedFileSnapshotsStorageKey);
			return;
		}
		storage.setItem(reviewedFileSnapshotsStorageKey, JSON.stringify(boundedPersisted));
	} catch {
		// Snapshot persistence is best effort and must not block review interactions.
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

function writePersistedTaskReviewedFileSnapshots(taskId: string, snapshots: Map<string, ReviewedFileSnapshot>): void {
	const persisted = readPersistedReviewedFileSnapshots();
	if (snapshots.size === 0) {
		delete persisted[taskId];
	} else {
		persisted[taskId] = Array.from(snapshots.entries());
	}
	writePersistedReviewedFileSnapshots(persisted, taskId);
}

function clearPersistedTaskReviewReviewedFiles(taskId?: string): void {
	if (taskId === undefined) {
		writePersistedReviewedFiles(Object.create(null) as PersistedReviewedFiles);
		writePersistedReviewedFileSnapshots(Object.create(null) as PersistedReviewedFileSnapshots);
		return;
	}

	const persisted = readPersistedReviewedFiles();
	delete persisted[taskId];
	writePersistedReviewedFiles(persisted);

	const persistedSnapshots = readPersistedReviewedFileSnapshots();
	delete persistedSnapshots[taskId];
	writePersistedReviewedFileSnapshots(persistedSnapshots);
}

export function getTaskReviewFileIdentity(file: TaskReviewFileIdentityInput): string | null {
	return getReviewFileIdentity(file);
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

export function getTaskReviewReviewedFileSnapshots(taskId: string): Map<string, ReviewedFileSnapshot> {
	return readPersistedTaskReviewedFileSnapshots(taskId);
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
	snapshot?: { newContent: string },
): TaskReviewPaneState {
	const reviewedFileShas = getTaskReviewReviewedFileShas(taskId);
	const snapshots = getTaskReviewReviewedFileSnapshots(taskId);
	const identity = getTaskReviewFileIdentity(file);
	if (identity === null) {
		reviewedFileShas.delete(file.filename);
		snapshots.delete(file.filename);
	} else {
		reviewedFileShas.set(file.filename, identity);
		if (snapshot !== undefined) {
			const reviewedSnapshot = { identity, newContent: snapshot.newContent };
			if (isReviewedFileSnapshotWithinPerFileCap(reviewedSnapshot)) {
				snapshots.set(file.filename, reviewedSnapshot);
			} else {
				snapshots.delete(file.filename);
			}
		} else {
			snapshots.delete(file.filename);
		}
	}
	writePersistedTaskReviewedFileSnapshots(taskId, snapshots);
	return updateTaskReviewPaneState(taskId, { reviewedFileShas });
}

export function unmarkTaskReviewFileReviewed(
	taskId: string,
	filename: string,
): TaskReviewPaneState {
	const reviewedFileShas = getTaskReviewReviewedFileShas(taskId);
	const snapshots = getTaskReviewReviewedFileSnapshots(taskId);
	reviewedFileShas.delete(filename);
	snapshots.delete(filename);
	writePersistedTaskReviewedFileSnapshots(taskId, snapshots);
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
