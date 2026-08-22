import { getCommitDiff, getTaskCommits, getTaskDiff } from "./ipc";
import { setSelfReviewDiffFiles } from "./taskScopedSelfReviewState";
import type { CommitInfo } from "./types";
import type { InitialSelfReviewContextLoader } from "./initialSelfReviewContextLoader.svelte";

// ============================================================================
// Interface
// ============================================================================

export interface DiffLoaderState {
	readonly isLoading: boolean;
	readonly error: string | null;
	readonly commits: CommitInfo[];
	readonly selectedCommitSha: string | null;
	loadDiff(): Promise<void>;
	loadCommits(): Promise<void>;
	selectCommit(sha: string | null): Promise<void>;
	refresh(): Promise<void>;
	cleanup(): void;
}

// ============================================================================
// Factory
// ============================================================================

export function createDiffLoader(deps: {
	getTaskId: () => string;
	/** Whether committed changes (merge-base..HEAD) are part of the diff. Defaults to true. */
	getIncludeCommitted?: () => boolean;
	getIncludeUncommitted: () => boolean;
	initialReviewContext?: Pick<
		InitialSelfReviewContextLoader,
		"hydrate" | "invalidate" | "cleanup"
	>;
	initialSelectedCommitSha?: string | null;
	onSelectedCommitShaChange?: (sha: string | null) => void;
}): DiffLoaderState {
	const getIncludeCommitted = deps.getIncludeCommitted ?? (() => true);
	let isLoading = $state(false);
	let error = $state<string | null>(null);
	let commits = $state<CommitInfo[]>([]);
	let selectedCommitSha = $state<string | null>(deps.initialSelectedCommitSha ?? null);
	let loadGeneration = 0;
	let commitLoadGeneration = 0;

	function beginLoad(): number {
		const generation = ++loadGeneration;
		deps.initialReviewContext?.invalidate();
		isLoading = true;
		error = null;
		return generation;
	}

	function isStale(generation: number): boolean {
		return generation !== loadGeneration;
	}

	function isCommitLoadStale(generation: number, taskId: string): boolean {
		return generation !== commitLoadGeneration || taskId !== deps.getTaskId();
	}

	async function fetchDiff(taskId: string) {
		return selectedCommitSha !== null
			? getCommitDiff(taskId, selectedCommitSha)
			: getTaskDiff(
					taskId,
					getIncludeCommitted(),
					deps.getIncludeUncommitted(),
				);
	}

	async function requestDiff(options: {
		loadInitialReviewData: boolean;
		failureLog: string;
		failureMessage: string;
	}): Promise<void> {
		const generation = beginLoad();
		try {
			const taskId = deps.getTaskId();
			const diffs = await fetchDiff(taskId);
			if (isStale(generation)) return;
			setSelfReviewDiffFiles(taskId, diffs);

			if (
				options.loadInitialReviewData &&
				selectedCommitSha === null &&
				deps.initialReviewContext
			) {
				await deps.initialReviewContext.hydrate(taskId);
				if (isStale(generation)) return;
			}
		} catch (e) {
			if (isStale(generation)) return;
			console.error(options.failureLog, e);
			error = options.failureMessage;
		} finally {
			if (!isStale(generation)) {
				isLoading = false;
			}
		}
	}

	async function loadDiff(): Promise<void> {
		await requestDiff({
			loadInitialReviewData: true,
			failureLog: "Failed to load self-review data:",
			failureMessage: "Failed to load diff. Please try again.",
		});
	}

	async function loadCommits(): Promise<void> {
		const generation = ++commitLoadGeneration;
		const taskId = deps.getTaskId();
		try {
			const nextCommits = await getTaskCommits(taskId);
			if (isCommitLoadStale(generation, taskId)) return;
			commits = nextCommits;
		} catch (e) {
			if (isCommitLoadStale(generation, taskId)) return;
			console.error("Failed to load commits:", e);
		}
	}

	async function selectCommit(sha: string | null): Promise<void> {
		selectedCommitSha = sha;
		deps.onSelectedCommitShaChange?.(sha);
		setSelfReviewDiffFiles(deps.getTaskId(), []);
		await refresh();
	}

	async function refresh(): Promise<void> {
		await requestDiff({
			loadInitialReviewData: false,
			failureLog: "Failed to refresh diff:",
			failureMessage: "Failed to refresh diff.",
		});
	}

	function cleanup(): void {
		loadGeneration += 1;
		commitLoadGeneration += 1;
		isLoading = false;
		error = null;
		deps.initialReviewContext?.cleanup(deps.getTaskId());
		setSelfReviewDiffFiles(deps.getTaskId(), []);
		selectedCommitSha = null;
		commits = [];
	}

	return {
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get commits() {
			return commits;
		},
		get selectedCommitSha() {
			return selectedCommitSha;
		},
		loadDiff,
		loadCommits,
		selectCommit,
		refresh,
		cleanup,
	};
}
