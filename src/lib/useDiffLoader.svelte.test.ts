import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommitInfo, PrFileDiff } from "./types";

// ============================================================================
// Module Mocks
// ============================================================================


vi.mock("./ipc", () => ({
	getTaskDiff:
		vi.fn<
			(
				taskId: string,
				includeCommitted: boolean,
				includeUncommitted: boolean,
			) => Promise<PrFileDiff[]>
		>(),
	getTaskCommits: vi.fn<(taskId: string) => Promise<CommitInfo[]>>(),
	getCommitDiff:
		vi.fn<(taskId: string, commitSha: string) => Promise<PrFileDiff[]>>(),
}));

import * as ipc from "./ipc";
import {
	getPendingSelfReviewComments,
	getSelfReviewDiffFiles,
	selfReviewStateByTask,
	setPendingSelfReviewComments,
} from "./taskScopedSelfReviewState";
import { createDiffLoader } from "./useDiffLoader.svelte";

const mockGetTaskDiff = vi.mocked(ipc.getTaskDiff);
const mockGetTaskCommits = vi.mocked(ipc.getTaskCommits);
const mockGetCommitDiff = vi.mocked(ipc.getCommitDiff);

async function withSuppressedExpectedConsoleError(run: () => Promise<void>) {
	const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	try {
		await run();
	} finally {
		consoleErrorSpy.mockRestore();
	}
}

// ============================================================================
// Fixtures
// ============================================================================

const baseDiff: PrFileDiff = {
	sha: "abc123",
	filename: "src/main.rs",
	status: "modified",
	additions: 5,
	deletions: 2,
	changes: 7,
	patch: "@@ -1,3 +1,4 @@\n line1\n+added\n line2",
	previous_filename: null,
	is_truncated: false,
	patch_line_count: null,
};


// ============================================================================
// Tests
// ============================================================================

describe("createDiffLoader", () => {
	const baseCommit: CommitInfo = {
		sha: "abc1234def",
		short_sha: "abc1234",
		message: "Fix login bug",
		author: "dev",
		date: "2025-01-01T00:00:00Z",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		selfReviewStateByTask.set(new Map());
		mockGetTaskDiff.mockResolvedValue([]);
		mockGetTaskCommits.mockResolvedValue([]);
		mockGetCommitDiff.mockResolvedValue([]);
	});

	it("starts with isLoading=false and error=null", () => {
		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		expect(loader.isLoading).toBe(false);
		expect(loader.error).toBeNull();
	});

	it("loadDiff sets isLoading=true during execution", async () => {
		let resolveGetTaskDiff!: (value: PrFileDiff[]) => void;
		mockGetTaskDiff.mockReturnValue(
			new Promise((resolve) => {
				resolveGetTaskDiff = resolve;
			}),
		);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		const promise = loader.loadDiff();
		expect(loader.isLoading).toBe(true);

		resolveGetTaskDiff([baseDiff]);
		await promise;

		expect(loader.isLoading).toBe(false);
	});

	it("loadDiff populates scoped self-review diff files on success", async () => {
		mockGetTaskDiff.mockResolvedValue([baseDiff]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.loadDiff();

		expect(getSelfReviewDiffFiles("task-1")).toEqual([baseDiff]);
	});

	it("invalidates in-flight initial review context without rehydrating on refresh", async () => {
		let resolveHydration!: () => void;
		mockGetTaskDiff.mockResolvedValue([baseDiff]);
		const initialReviewContext = {
			hydrate: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						resolveHydration = resolve;
					}),
			),
			invalidate: vi.fn(),
			cleanup: vi.fn(),
		};
		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
			initialReviewContext,
		});

		const initialLoad = loader.loadDiff();
		await vi.waitFor(() => {
			expect(initialReviewContext.hydrate).toHaveBeenCalledWith("task-1");
		});
		await loader.refresh();
		resolveHydration();
		await initialLoad;

		expect(initialReviewContext.hydrate).toHaveBeenCalledTimes(1);
		expect(initialReviewContext.invalidate).toHaveBeenCalledTimes(2);
	});

	it("loadDiff sets human-readable error on failure", async () => {
		await withSuppressedExpectedConsoleError(async () => {
			mockGetTaskDiff.mockRejectedValue(new Error("network error"));

			const loader = createDiffLoader({
				getTaskId: () => "task-1",
				getIncludeUncommitted: () => false,
			});

			await loader.loadDiff();

			expect(loader.error).toBe("Failed to load diff. Please try again.");
			expect(loader.isLoading).toBe(false);
		});
	});

	it("loadDiff calls IPC with correct taskId and scope flags", async () => {
		mockGetTaskDiff.mockResolvedValue([]);

		const loader = createDiffLoader({
			getTaskId: () => "task-42",
			getIncludeCommitted: () => true,
			getIncludeUncommitted: () => true,
		});

		await loader.loadDiff();

		expect(mockGetTaskDiff).toHaveBeenCalledWith("task-42", true, true);
	});

	it("loadDiff forwards getIncludeCommitted=false for uncommitted-only review", async () => {
		mockGetTaskDiff.mockResolvedValue([]);

		const loader = createDiffLoader({
			getTaskId: () => "task-7",
			getIncludeCommitted: () => false,
			getIncludeUncommitted: () => true,
		});

		await loader.loadDiff();

		expect(mockGetTaskDiff).toHaveBeenCalledWith("task-7", false, true);
	});

	it("defaults includeCommitted to true when no getter is provided", async () => {
		mockGetTaskDiff.mockResolvedValue([]);

		const loader = createDiffLoader({
			getTaskId: () => "task-9",
			getIncludeUncommitted: () => false,
		});

		await loader.loadDiff();

		expect(mockGetTaskDiff).toHaveBeenCalledWith("task-9", true, false);
	});

	it("refresh reloads diff data", async () => {
		mockGetTaskDiff.mockResolvedValue([baseDiff]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.refresh();

		expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, false);
		expect(getSelfReviewDiffFiles("task-1")).toEqual([baseDiff]);
	});

	it("refresh sets human-readable error on failure", async () => {
		await withSuppressedExpectedConsoleError(async () => {
			mockGetTaskDiff.mockRejectedValue(new Error("network error"));

			const loader = createDiffLoader({
				getTaskId: () => "task-1",
				getIncludeUncommitted: () => false,
			});

			await loader.refresh();

			expect(loader.error).toBe("Failed to refresh diff.");
			expect(loader.isLoading).toBe(false);
		});
	});

	it("keeps the latest diff when an earlier refresh resolves late", async () => {
		let resolveFirst!: (value: PrFileDiff[]) => void;
		let resolveSecond!: (value: PrFileDiff[]) => void;
		const firstDiff = [{ ...baseDiff, filename: "src/first.rs" }];
		const secondDiff = [{ ...baseDiff, filename: "src/second.rs" }];

		mockGetTaskDiff
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
			)
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveSecond = resolve;
				}),
			);
		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		const firstRefresh = loader.refresh();
		const secondRefresh = loader.refresh();

		resolveSecond(secondDiff);
		await secondRefresh;
		expect(getSelfReviewDiffFiles("task-1")).toEqual(secondDiff);

		resolveFirst(firstDiff);
		await firstRefresh;
		expect(getSelfReviewDiffFiles("task-1")).toEqual(secondDiff);
		expect(loader.isLoading).toBe(false);
	});


	it("preserves pending inline comments when remounting a selected commit diff", async () => {
		mockGetCommitDiff.mockResolvedValue([baseDiff]);
		const pendingInlineComment = {
			path: "src/main.rs",
			line: 42,
			side: "RIGHT",
			body: "Keep this feedback on commit view",
		};
		setPendingSelfReviewComments("task-1", [pendingInlineComment]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
			initialSelectedCommitSha: "abc1234",
		});
		await loader.loadDiff();

		expect(mockGetCommitDiff).toHaveBeenCalledWith("task-1", "abc1234");
		expect(getPendingSelfReviewComments("task-1")).toEqual([pendingInlineComment]);
	});

	it("starts with empty commits and null selectedCommitSha", () => {
		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		expect(loader.commits).toEqual([]);
		expect(loader.selectedCommitSha).toBeNull();
	});

	it("loadDiff with no commit selected calls getTaskDiff", async () => {
		mockGetTaskDiff.mockResolvedValue([baseDiff]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.loadDiff();

		expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, false);
		expect(mockGetCommitDiff).not.toHaveBeenCalled();
		expect(getSelfReviewDiffFiles("task-1")).toEqual([baseDiff]);
	});

	it("loadDiff with commit selected calls getCommitDiff, not getTaskDiff", async () => {
		mockGetCommitDiff.mockResolvedValue([baseDiff]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.selectCommit("abc1234");
		await loader.loadDiff();

		expect(mockGetCommitDiff).toHaveBeenCalledWith("task-1", "abc1234");
		expect(mockGetTaskDiff).not.toHaveBeenCalled();
	});

	it("loadCommits populates commits array", async () => {
		mockGetTaskCommits.mockResolvedValue([baseCommit]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.loadCommits();

		expect(loader.commits).toEqual([baseCommit]);
		expect(mockGetTaskCommits).toHaveBeenCalledWith("task-1");
	});

	it("keeps commits for the latest Task when an earlier request resolves late", async () => {
		let resolveTaskOne!: (value: CommitInfo[]) => void;
		let resolveTaskTwo!: (value: CommitInfo[]) => void;
		const taskOneCommits = [
			{ ...baseCommit, sha: "task-one", short_sha: "task-one" },
		];
		const taskTwoCommits = [
			{ ...baseCommit, sha: "task-two", short_sha: "task-two" },
		] satisfies CommitInfo[];
		const taskOnePromise = new Promise<CommitInfo[]>((resolve) => {
			resolveTaskOne = resolve;
		});
		const taskTwoPromise = new Promise<CommitInfo[]>((resolve) => {
			resolveTaskTwo = resolve;
		});
		let taskId = "task-1";

		mockGetTaskCommits.mockImplementation((requestedTaskId) => {
			return requestedTaskId === "task-1" ? taskOnePromise : taskTwoPromise;
		});
		const loader = createDiffLoader({
			getTaskId: () => taskId,
			getIncludeUncommitted: () => false,
		});

		const taskOneLoad = loader.loadCommits();
		taskId = "task-2";
		const taskTwoLoad = loader.loadCommits();

		resolveTaskTwo(taskTwoCommits);
		await taskTwoLoad;
		expect(loader.commits).toEqual(taskTwoCommits);

		resolveTaskOne(taskOneCommits);
		await taskOneLoad;
		expect(loader.commits).toEqual(taskTwoCommits);
	});

	it("discards commit results when the Task changes without another request", async () => {
		let resolveCommits!: (value: CommitInfo[]) => void;
		const pendingCommits = new Promise<CommitInfo[]>((resolve) => {
			resolveCommits = resolve;
		});
		let taskId = "task-1";

		mockGetTaskCommits.mockReturnValue(pendingCommits);
		const loader = createDiffLoader({
			getTaskId: () => taskId,
			getIncludeUncommitted: () => false,
		});

		const load = loader.loadCommits();
		taskId = "task-2";
		resolveCommits([baseCommit]);
		await load;

		expect(loader.commits).toEqual([]);
	});

	it("selectCommit clears store then loads commit diff", async () => {
		mockGetTaskDiff.mockResolvedValue([baseDiff]);
		mockGetCommitDiff.mockResolvedValue([
			{ ...baseDiff, filename: "src/other.rs" },
		]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.loadDiff();
		expect(getSelfReviewDiffFiles("task-1")).toHaveLength(1);

		await loader.selectCommit("abc1234");

		expect(loader.selectedCommitSha).toBe("abc1234");
		expect(getSelfReviewDiffFiles("task-1")).toEqual([
			{ ...baseDiff, filename: "src/other.rs" },
		]);
	});

	it("selectCommit(null) restores aggregate mode", async () => {
		mockGetCommitDiff.mockResolvedValue([baseDiff]);
		mockGetTaskDiff.mockResolvedValue([baseDiff]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.selectCommit("abc1234");
		expect(loader.selectedCommitSha).toBe("abc1234");

		await loader.selectCommit(null);

		expect(loader.selectedCommitSha).toBeNull();
		expect(mockGetTaskDiff).toHaveBeenCalled();
	});

	it("selectCommit keeps the latest commit diff when earlier requests resolve late", async () => {
		let resolveFirst!: (value: PrFileDiff[]) => void;
		let resolveSecond!: (value: PrFileDiff[]) => void;

		const firstPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveFirst = resolve;
		});
		const secondPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveSecond = resolve;
		});

		const firstDiff = [{ ...baseDiff, filename: "src/first.rs" }];
		const secondDiff = [{ ...baseDiff, filename: "src/second.rs" }];

		mockGetCommitDiff.mockImplementation(async (_taskId, commitSha) => {
			if (commitSha === "first-sha") return firstPromise;
			if (commitSha === "second-sha") return secondPromise;
			return [];
		});

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		const firstSelection = loader.selectCommit("first-sha");
		const secondSelection = loader.selectCommit("second-sha");

		resolveSecond(secondDiff);
		await secondSelection;

		expect(loader.selectedCommitSha).toBe("second-sha");
		expect(getSelfReviewDiffFiles("task-1")).toEqual(secondDiff);

		resolveFirst(firstDiff);
		await firstSelection;

		expect(loader.selectedCommitSha).toBe("second-sha");
		expect(getSelfReviewDiffFiles("task-1")).toEqual(secondDiff);
	});

	it("ignores stale request failures after a newer commit selection starts", async () => {
		let rejectFirst!: (reason?: unknown) => void;
		let resolveSecond!: (value: PrFileDiff[]) => void;

		const firstPromise = new Promise<PrFileDiff[]>((_resolve, reject) => {
			rejectFirst = reject;
		});
		const secondPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveSecond = resolve;
		});

		const secondDiff = [{ ...baseDiff, filename: "src/second.rs" }];

		mockGetCommitDiff.mockImplementation(async (_taskId, commitSha) => {
			if (commitSha === "first-sha") return firstPromise;
			if (commitSha === "second-sha") return secondPromise;
			return [];
		});

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		const firstSelection = loader.selectCommit("first-sha");
		const secondSelection = loader.selectCommit("second-sha");

		rejectFirst(new Error("stale failure"));
		await firstSelection;

		expect(loader.error).toBeNull();
		expect(loader.isLoading).toBe(true);

		resolveSecond(secondDiff);
		await secondSelection;

		expect(loader.error).toBeNull();
		expect(loader.isLoading).toBe(false);
		expect(getSelfReviewDiffFiles("task-1")).toEqual(secondDiff);
	});

	it("refresh in commit mode uses getCommitDiff", async () => {
		mockGetCommitDiff.mockResolvedValue([baseDiff]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.selectCommit("abc1234");
		mockGetCommitDiff.mockClear();
		mockGetTaskDiff.mockClear();

		await loader.refresh();

		expect(mockGetCommitDiff).toHaveBeenCalledWith("task-1", "abc1234");
		expect(mockGetTaskDiff).not.toHaveBeenCalled();
	});

	it("cleanup resets commits and selectedCommitSha", async () => {
		mockGetTaskCommits.mockResolvedValue([baseCommit]);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		await loader.loadCommits();
		await loader.selectCommit("abc1234");
		expect(loader.commits).toHaveLength(1);
		expect(loader.selectedCommitSha).toBe("abc1234");

		loader.cleanup();

		expect(loader.commits).toEqual([]);
		expect(loader.selectedCommitSha).toBeNull();
	});

	it("cleanup invalidates in-flight diff loads", async () => {
		let resolveDiff!: (value: PrFileDiff[]) => void;
		const pendingDiff = new Promise<PrFileDiff[]>((resolve) => {
			resolveDiff = resolve;
		});

		mockGetTaskDiff.mockReturnValue(pendingDiff);

		const loader = createDiffLoader({
			getTaskId: () => "task-1",
			getIncludeUncommitted: () => false,
		});

		const loadPromise = loader.loadDiff();
		loader.cleanup();

		resolveDiff([{ ...baseDiff, filename: "src/late.rs" }]);
		await loadPromise;

		expect(loader.isLoading).toBe(false);
		expect(loader.error).toBeNull();
		expect(getSelfReviewDiffFiles("task-1")).toEqual([]);
	});

});
