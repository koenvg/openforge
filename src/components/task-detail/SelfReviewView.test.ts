import { DiffFile } from "@git-diff-view/core";
import { highlighter } from "@git-diff-view/lowlight";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { writable } from "svelte/store";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { configureDiffHighlighter } from "@openforge-app/pr-review-ui/diffHighlightConfig";
import { requireElement } from "../../test-utils/dom";
import type { DiffWorkerRequest, DiffWorkerResponse } from "@openforge-app/pr-review-ui/diffWorker";
import type {
	PrComment,
	PrFileDiff,
	PullRequestInfo,
	Task,
} from "../../lib/types";

vi.mock("../../lib/stores", () => ({
	pendingManualComments: writable([]),
	ticketPrs: writable(new Map()),
	taskDraftNotes: writable(new Map()),
}));

const { navigateMock } = vi.hoisted(() => ({ navigateMock: vi.fn() }))

vi.mock('../../lib/fileViewerPlugin', () => ({
  FILE_VIEWER_VIEW_KEY: 'plugin:com.openforge.file-viewer:files',
  revealFileInFileViewer: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../lib/router.svelte', () => ({
  useAppRouter: () => ({ navigate: navigateMock }),
}))

vi.mock("@openforge-app/pr-review-ui/useVirtualizer.svelte", () => ({
	createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
		get virtualItems() {
			const count = opts.getCount();
			return Array.from({ length: count }, (_, i) => ({
				key: i,
				index: i,
				start: i * 300,
				end: (i + 1) * 300,
				size: 300,
				lane: 0,
			}));
		},
		totalSize: 0,
		scrollToIndex: vi.fn(),
		measureAction: () => ({ destroy() {} }),
	})),
}));

vi.mock("../../lib/ipc", () => ({
	getTaskDiff: vi.fn().mockResolvedValue([]),
	getTaskCommits: vi.fn().mockResolvedValue([]),
	getCommitDiff: vi.fn().mockResolvedValue([]),
	getTaskFileContents: vi.fn().mockResolvedValue(["", ""]),
	getTaskBatchFileContents: vi.fn().mockResolvedValue([["", ""]]),
	getCommitFileContents: vi.fn().mockResolvedValue(["", ""]),
	getCommitBatchFileContents: vi.fn().mockResolvedValue([["", ""]]),
	getActiveSelfReviewComments: vi.fn().mockResolvedValue([]),
	getArchivedSelfReviewComments: vi.fn().mockResolvedValue([]),
	getPrComments: vi.fn().mockResolvedValue([]),
	markCommentAddressed: vi.fn().mockResolvedValue(undefined),
	openUrl: vi.fn(),
	addSelfReviewComment: vi.fn().mockResolvedValue(undefined),
	deleteSelfReviewComment: vi.fn().mockResolvedValue(undefined),
	archiveSelfReviewComments: vi.fn().mockResolvedValue(undefined),
}));

import SelfReviewView from "./SelfReviewView.svelte";

import {
	getActiveSelfReviewComments,
	getCommitDiff,
	getPrComments,
	markCommentAddressed,
	getTaskBatchFileContents,
	getTaskCommits,
	getTaskFileContents,
	getTaskDiff,
} from "../../lib/ipc";
import { pendingManualComments, ticketPrs } from "../../lib/stores";
import {
	selfReviewStateByTask,
	setSelfReviewArchivedComments,
	setSelfReviewDiffFiles,
	setSelfReviewGeneralComments,
} from "../../lib/taskScopedSelfReviewState";
import { createVirtualizer } from "@openforge-app/pr-review-ui/useVirtualizer.svelte";
import { clearTaskReviewPaneState, getTaskReviewFileIdentity, getTaskReviewPaneState, markTaskReviewFileReviewed } from "../../lib/taskReviewPaneState";
import { FILE_VIEWER_VIEW_KEY, revealFileInFileViewer } from '../../lib/fileViewerPlugin';
const baseTask: Task = {
	id: "task-1",
	initial_prompt: "Test Task",
	status: "doing",
	project_id: "proj-1",
	prompt: null,
	title: null,
	title_source: null,
	title_generated_at: null,
	agent: null,
	permission_mode: null,
	worktree_source: null,
	worktree_branch: null,
	source_ticket_url: null,
	depends_on: [],
	created_at: Date.now(),
	updated_at: Date.now(),
};

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

class InlineDiffWorker {
	onmessage: ((ev: MessageEvent<DiffWorkerResponse>) => void) | null = null;
	onerror: ((ev: ErrorEvent) => void) | null = null;

	postMessage(message: DiffWorkerRequest): void {
		queueMicrotask(() => {
			try {
				if (message.type !== "process") return;

				const file = new DiffFile(
					message.data.oldFile.fileName,
					message.data.oldFile.content ?? "",
					message.data.newFile.fileName,
					message.data.newFile.content ?? "",
					message.data.hunks,
					message.data.oldFile.fileLang,
					message.data.newFile.fileLang,
				);

				file.initTheme(message.theme);
				file.initRaw();
				file.initSyntax({ registerHighlighter: highlighter });
				file.buildSplitDiffLines();
				file.buildUnifiedDiffLines();

				this.onmessage?.({
					data: { type: "result", id: message.id, bundle: file._getFullBundle() },
				} as MessageEvent<DiffWorkerResponse>);
				file.clearId();
			} catch (error) {
				this.onmessage?.({
					data: { type: "error", id: message.id, error: String(error) },
				} as MessageEvent<DiffWorkerResponse>);
			}
		});
	}

	terminate(): void {}
	addEventListener(): void {}
	removeEventListener(): void {}
	dispatchEvent(): boolean { return false; }
}

const defaultWorker = globalThis.Worker;

beforeAll(() => {
	configureDiffHighlighter(highlighter);
});

afterEach(() => {
	globalThis.Worker = defaultWorker;
});

describe("SelfReviewView uncommitted toggle", () => {
	beforeEach(() => {
		clearTaskReviewPaneState();
		selfReviewStateByTask.set(new Map());
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	it("defaults to both committed and uncommitted checked", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const committed = requireElement(screen.getByLabelText("Include committed changes"), HTMLInputElement);
			const uncommitted = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
			expect(committed.checked).toBe(true);
			expect(uncommitted.checked).toBe(true);
		});
	});

	it("leaves both checkboxes unlocked when both scopes are selected by default", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const committed = requireElement(screen.getByLabelText("Include committed changes"), HTMLInputElement);
			const uncommitted = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
			// Both scopes are on by default, so neither checkbox is locked.
			expect(committed.disabled).toBe(false);
			expect(uncommitted.disabled).toBe(false);
		});
	});

	it("initial load calls getTaskDiff with both committed and uncommitted scope", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, true);
		});
	});

	it("toggle visible even with no diff files (empty state)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			const checkbox = screen.getByLabelText("Include uncommitted changes");
			expect(checkbox).toBeTruthy();
			expect(requireElement(checkbox, HTMLInputElement).checked).toBe(true);
		});
	});

	it("unchecking uncommitted requests committed-only changes", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await screen.findByLabelText("Include uncommitted changes");
		mockGetTaskDiff.mockClear();

		await waitFor(() => {
			expect(screen.getByLabelText("Include uncommitted changes").isConnected).toBe(true);
		});

		// Uncommitted is on by default; unchecking it leaves committed-only.
		const cb = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
		cb.click();
		cb.dispatchEvent(new Event("change", { bubbles: true }));

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, false);
		});
	});

	it("unchecking committed requests uncommitted-only diff and locks the uncommitted checkbox", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		// Both scopes are on by default, so the committed checkbox is unlocked.
		const committed = requireElement(
			await screen.findByLabelText("Include committed changes"),
			HTMLInputElement,
		);
		await waitFor(() => {
			expect(committed.disabled).toBe(false);
		});

		mockGetTaskDiff.mockClear();

		// Uncheck committed → only uncommitted remains selected.
		committed.click();
		committed.dispatchEvent(new Event("change", { bubbles: true }));

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", false, true);
			const uncommittedAfter = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
			// Uncommitted is now the only scope, so it must be locked.
			expect(uncommittedAfter.disabled).toBe(true);
		});
	});

	it("specific commit mode hides uncommitted checkbox and shows recovery action", async () => {
		const commitDiff = { ...baseDiff, filename: "src/only-commit.rs" };
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		const mockGetCommitDiff = vi.mocked(getCommitDiff);

		mockGetTaskDiff.mockResolvedValue([baseDiff]);
		mockGetCommitDiff.mockResolvedValue([commitDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(screen.getByLabelText("Include uncommitted changes")).toBeTruthy();
		});

		const commitButton = screen.getByText("All changes");
		commitButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		await waitFor(() => {
			expect(screen.queryByLabelText("Include uncommitted changes")).toBeTruthy();
			expect(screen.queryByText("Show all changes")).toBeNull();
		});
	});
});

describe('SelfReviewView review workspace', () => {
	beforeEach(() => {
		clearTaskReviewPaneState();
		selfReviewStateByTask.set(new Map());
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	it('presents Changed files, Code diff, and Feedback as the primary review regions', async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		expect(await screen.findByRole('region', { name: 'Changed files panel' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Code diff panel' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Feedback panel' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse Changed files panel' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse Feedback panel' })).toBeTruthy();
	});

	it('moves keyboard focus between the Review File Tree and diff with Tab and Shift+Tab', async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		const tree = await screen.findByRole('tree', { name: 'Changed files' });
		const diff = await screen.findByRole('region', { name: 'Diff scroll area' });
		tree.focus();
		await fireEvent.keyDown(tree, { key: 'Tab' });
		expect(document.activeElement).toBe(diff);

		await fireEvent.keyDown(diff, { key: 'Tab', shiftKey: true });
		expect(document.activeElement).toBe(tree);
	});

	it('keeps mark-reviewed controls on diff file sections without a duplicate selected-file bar', async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		expect(await screen.findByLabelText('Mark src/main.rs reviewed')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Mark selected file reviewed' })).toBeNull();
	});
});


describe("SelfReviewView integration — performance fixes", () => {
	beforeEach(() => {
		clearTaskReviewPaneState();
		selfReviewStateByTask.set(new Map());
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	it("commit history pane remains visible while loading diffs", async () => {
		// Start with a mock that won't resolve immediately
		let resolveTaskDiff: (val: PrFileDiff[]) => void = () => {};
		const diffPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveTaskDiff = resolve;
		});
		vi.mocked(getTaskDiff).mockReturnValue(diffPromise);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		// Wait for the loading spinner to appear
		await screen.findByText("Loading diff...");

		// Crucially, the File and Commit history panes should STILL be visible!
		// (This will fail currently because the whole view is gated on isLoading)
		expect(screen.getByText("Scope")).toBeTruthy();
		expect(screen.getByText("Changed files")).toBeTruthy();

		// Let it finish to clean up
		resolveTaskDiff([baseDiff]);
	});

	it("getTaskDiff called exactly once on mount", async () => {
		const mockGetTaskDiff = vi
			.mocked(getTaskDiff)
			.mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledTimes(1);
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, true);
		});
	});

	it("getActiveSelfReviewComments called exactly once on mount", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		const mockGetActiveComments = vi.mocked(getActiveSelfReviewComments);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(mockGetActiveComments).toHaveBeenCalledTimes(1);
			expect(mockGetActiveComments).toHaveBeenCalledWith("task-1");
		});
	});

	it("DiffViewer toolbar visible after toggle (DiffViewer successfully re-mounted)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(screen.getByTitle("Search (\u2318F)")).toBeTruthy();
		});

		const cb = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
		cb.click();
		cb.dispatchEvent(new Event("change", { bubbles: true }));

		await waitFor(
			() => {
				expect(screen.getByTitle("Search (\u2318F)")).toBeTruthy();
			},
			{ timeout: 2000 },
		);
	});

	it("commit switching preserves panes and file scrolling when earlier diff responses finish late", async () => {
		const firstCommit = {
			sha: "first-sha",
			short_sha: "first",
			message: "First commit",
			author: "dev",
			date: "2025-01-01T00:00:00Z",
		};
		const secondCommit = {
			sha: "second-sha",
			short_sha: "second",
			message: "Second commit",
			author: "dev",
			date: "2025-01-02T00:00:00Z",
		};

		let resolveFirstCommit!: (value: PrFileDiff[]) => void;
		let resolveSecondCommit!: (value: PrFileDiff[]) => void;

		const firstCommitPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveFirstCommit = resolve;
		});
		const secondCommitPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveSecondCommit = resolve;
		});

		const firstCommitDiff = [{ ...baseDiff, filename: "src/first.ts" }];
		const secondCommitDiff = [{ ...baseDiff, filename: "src/second.ts" }];

		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskCommits).mockResolvedValue([firstCommit, secondCommit]);
		vi.mocked(getCommitDiff).mockImplementation(async (_taskId, commitSha) => {
			if (commitSha === firstCommit.sha) return firstCommitPromise;
			if (commitSha === secondCommit.sha) return secondCommitPromise;
			return [];
		});

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(screen.getByTitle(firstCommit.message)).toBeTruthy();
			expect(screen.getByTitle(secondCommit.message)).toBeTruthy();
		});

		await fireEvent.click(screen.getByTitle(firstCommit.message));
		await fireEvent.click(screen.getByTitle(secondCommit.message));

		expect(screen.getByText("Scope")).toBeTruthy();
		expect(screen.getByText("Changed files")).toBeTruthy();
		expect(screen.getByText("Loading diff...")).toBeTruthy();

		resolveSecondCommit(secondCommitDiff);

		await waitFor(() => {
			expect(screen.getByText("second.ts")).toBeTruthy();
		});

		resolveFirstCommit(firstCommitDiff);

		await waitFor(() => {
			expect(screen.getByText("second.ts")).toBeTruthy();
		});

		expect(screen.queryByText("first.ts")).toBeNull();
		expect(screen.getByText("Scope")).toBeTruthy();

		const mockCreateVirtualizer = vi.mocked(createVirtualizer);
		const virtualizer = mockCreateVirtualizer.mock.results.at(-1)?.value;
		expect(virtualizer).toBeTruthy();

		await fireEvent.click(screen.getByText("second.ts"));

		expect(virtualizer?.scrollToIndex).toHaveBeenCalledWith(0, {
			align: "start",
			behavior: "smooth",
		});
	});
});

describe("SelfReviewView pane restoration", () => {
	beforeEach(() => {
		clearTaskReviewPaneState();
		selfReviewStateByTask.set(new Map());
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	it("restores the selected commit when the review pane is remounted for the same task", async () => {
		const commit = {
			sha: "commit-sha",
			short_sha: "commit",
			message: "Keep selected commit",
			author: "dev",
			date: "2025-01-01T00:00:00Z",
		};
		const commitDiff = { ...baseDiff, filename: "src/commit-only.ts" };
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskCommits).mockResolvedValue([commit]);
		vi.mocked(getCommitDiff).mockResolvedValue([commitDiff]);

		const firstRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(screen.getByTitle(commit.message)).toBeTruthy();
		});

		await fireEvent.click(screen.getByTitle(commit.message));

		await waitFor(() => {
			expect(screen.getByText("Show all changes")).toBeTruthy();
			expect(getCommitDiff).toHaveBeenCalledWith(baseTask.id, commit.sha);
		});

		firstRender.unmount();
		vi.mocked(getCommitDiff).mockClear();

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(screen.getByText("Show all changes")).toBeTruthy();
			expect(getCommitDiff).toHaveBeenCalledWith(baseTask.id, commit.sha);
		});
	});

	it("restores the diff scroll position when the review pane is remounted for the same task", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		const firstRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		let scrollArea!: HTMLElement;
		await waitFor(() => {
			scrollArea = requireElement(screen.getByRole("region", { name: "Diff scroll area" }), HTMLElement);
		});
		Object.defineProperty(scrollArea, "scrollTop", { value: 184, writable: true, configurable: true });
		await fireEvent.scroll(scrollArea);
		expect(getTaskReviewPaneState(baseTask.id).diffScrollTop).toBe(184);

		firstRender.unmount();

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			const restoredScrollArea = requireElement(screen.getByRole("region", { name: "Diff scroll area" }), HTMLElement);
			expect(restoredScrollArea.scrollTop).toBe(184);
		});
	});

	it("marks a file reviewed from the diff header while keeping the file tree row in place", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		const checkbox = requireElement(await screen.findByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
		expect(checkbox.checked).toBe(false);

		await fireEvent.click(checkbox);

		await waitFor(() => {
			const checked = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checked.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
			expect(getTaskReviewPaneState(baseTask.id).reviewedFileShas.get(baseDiff.filename)).toBe(baseDiff.sha);
		});

		await fireEvent.click(screen.getByLabelText("Mark src/main.rs reviewed"));

		await waitFor(() => {
			const unchecked = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(unchecked.checked).toBe(false);
			expect(screen.queryByLabelText("Reviewed file src/main.rs")).toBeNull();
			expect(getTaskReviewPaneState(baseTask.id).reviewedFileShas.has(baseDiff.filename)).toBe(false);
		});
	});

	it("can compare current changes against the last reviewed file snapshot", async () => {
		globalThis.Worker = InlineDiffWorker as unknown as typeof Worker;
		const originalDiff = {
			...baseDiff,
			sha: "",
			patch: "@@ -1,1 +1,1 @@\n-base content\n+reviewed content",
		};
		const changedDiff = {
			...baseDiff,
			sha: "",
			patch: "@@ -1,1 +1,1 @@\n-base content\n+changed content",
		};
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		mockGetTaskDiff.mockResolvedValueOnce([originalDiff]).mockResolvedValue([changedDiff]);
		vi.mocked(getTaskFileContents).mockResolvedValue(["base content\n", "reviewed content\n"]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["base content\n", "changed content\n"]]);

		const firstRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		const checkbox = requireElement(await screen.findByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
		await fireEvent.click(checkbox);
		await waitFor(() => {
			expect(vi.mocked(getTaskFileContents)).toHaveBeenCalledWith(
				baseTask.id,
				originalDiff.filename,
				originalDiff.previous_filename,
				originalDiff.status,
				true,
				true,
			);
		});

		firstRender.unmount();

		const currentRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			expect(currentRender.container.textContent).toContain("changed content");
			expect(currentRender.container.textContent).not.toContain("reviewed content");
		});

		expect(screen.queryByText("Comparing with last reviewed version")).toBeNull();
		expect(screen.queryByRole("button", { name: "Back to all changes" })).toBeNull();

		const sinceReviewedButton = await screen.findByRole("button", {
			name: "Compare src/main.rs with Reviewed File Snapshot",
		});
		await fireEvent.click(sinceReviewedButton);

		await waitFor(() => {
			expect(screen.queryByText("Comparing with last reviewed version")).toBeNull();
			expect(screen.queryByRole("button", { name: "Back to all changes" })).toBeNull();
			expect(screen.getByRole("button", { name: "Show normal diff for src/main.rs" })).toBeTruthy();
			expect(vi.mocked(getTaskBatchFileContents)).toHaveBeenCalledWith(
				baseTask.id,
				[{ path: changedDiff.filename, oldPath: changedDiff.previous_filename, status: changedDiff.status }],
				true,
				true,
			);
			expect(currentRender.container.textContent).toContain("reviewed content");
			expect(currentRender.container.textContent).toContain("changed content");
			expect(currentRender.container.textContent).not.toContain("base content");
		});

		await fireEvent.click(screen.getByRole("button", { name: "Show normal diff for src/main.rs" }));

		await waitFor(() => {
			expect(screen.getByRole("button", { name: "Compare src/main.rs with Reviewed File Snapshot" })).toBeTruthy();
			expect(currentRender.container.textContent).toContain("changed content");
			expect(currentRender.container.textContent).not.toContain("reviewed content");
		});

		await fireEvent.click(screen.getByRole("button", { name: "Compare src/main.rs with Reviewed File Snapshot" }));
		await waitFor(() => {
			expect(currentRender.container.textContent).toContain("reviewed content");
		});

		await fireEvent.click(screen.getByLabelText("Mark src/main.rs reviewed"));

		await waitFor(() => {
			expect(getTaskReviewPaneState(baseTask.id).reviewedFileShas.get(changedDiff.filename)).toBe(
				getTaskReviewFileIdentity(changedDiff),
			);
			expect(screen.queryByRole("button", { name: "Compare src/main.rs with Reviewed File Snapshot" })).toBeNull();
			expect(screen.queryByRole("button", { name: "Show normal diff for src/main.rs" })).toBeNull();
			const allChangesCheckbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(allChangesCheckbox.checked).toBe(true);
		});
	}, 15_000);

	it("remembers reviewed files across remounts until their sha changes", async () => {
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		mockGetTaskDiff.mockResolvedValue([baseDiff]);

		const firstRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await screen.findByLabelText("Mark src/main.rs reviewed");
		markTaskReviewFileReviewed(baseTask.id, baseDiff);
		firstRender.unmount();

		const secondRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});

		secondRender.unmount();
		mockGetTaskDiff.mockResolvedValue([{ ...baseDiff, sha: "changed-sha" }]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(false);
			expect(screen.queryByLabelText("Reviewed file src/main.rs")).toBeNull();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});
	});

	it("remembers empty-sha reviewed files by diff content and shows them again when content changes", async () => {
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		const emptyShaDiff = { ...baseDiff, sha: "" };
		mockGetTaskDiff.mockResolvedValue([emptyShaDiff]);

		const firstRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await fireEvent.click(await screen.findByLabelText("Mark src/main.rs reviewed"));

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});

		firstRender.unmount();

		const secondRender = render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});

		secondRender.unmount();
		mockGetTaskDiff.mockResolvedValue([
			{
				...emptyShaDiff,
				additions: emptyShaDiff.additions + 1,
				changes: emptyShaDiff.changes + 1,
				patch: `${emptyShaDiff.patch}\n+new content`,
			},
		]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(false);
			expect(screen.queryByLabelText("Reviewed file src/main.rs")).toBeNull();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});
	});

	it("hides and restores the full left pane while keeping reviewed file state synced", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await fireEvent.click(await screen.findByLabelText("Mark src/main.rs reviewed"));

		await waitFor(() => {
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
		});

		await fireEvent.click(screen.getByTitle("Hide file tree"));

		await waitFor(() => {
			expect(screen.queryByText("Files")).toBeNull();
			expect(screen.queryByText("Commit history")).toBeNull();
			expect(screen.queryByLabelText("Reviewed file src/main.rs")).toBeNull();
		});

		await fireEvent.click(screen.getByTitle("Show file tree"));

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});
	});

	it("keeps a left pane restore control when a hidden pane refreshes to an empty diff", async () => {
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		mockGetTaskDiff.mockResolvedValueOnce([baseDiff]).mockResolvedValueOnce([]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await screen.findByText("src/main.rs");
		await fireEvent.click(screen.getByTitle("Hide file tree"));

		await waitFor(() => {
			expect(screen.queryByText("Commit history")).toBeNull();
		});

		await fireEvent.click(screen.getByTitle("Refresh diff"));

		await waitFor(() => {
			expect(screen.getByText("No changes for current selection")).toBeTruthy();
		});

		await fireEvent.click(screen.getByTitle("Show file tree"));

		await waitFor(() => {
			expect(screen.getByText("Changed files")).toBeTruthy();
			expect(screen.getByText("Scope")).toBeTruthy();
		});
	});
});

describe("SelfReviewView — hide addressed comments", () => {
	beforeEach(() => {
		setSelfReviewDiffFiles("task-1", [baseDiff]);
		setSelfReviewGeneralComments("task-1", []);
		setSelfReviewArchivedComments("task-1", []);
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	const makeComment = (id: number, addressed: number, body = `Comment ${id}`): PrComment => ({
		id,
		pr_id: 1,
		author: "alice",
		body,
		comment_type: "review_comment",
		file_path: "src/main.rs",
		line_number: 10,
		addressed,
		outdated: 0,
		created_at: 1000 + id,
	});

	const mockPr: PullRequestInfo = {
		id: 1,
		pr_number: 1,
		ticket_id: "task-1",
		repo_owner: "acme",
		repo_name: "repo",
		title: "Test PR",
		url: "https://github.com/acme/repo/pull/1",
		state: "open",
		head_sha: "abc",
		ci_status: null,
		ci_check_runs: null,
		review_status: null,
		mergeable: null,
		mergeable_state: null,
		merged_at: null,
		created_at: 1000,
		updated_at: 2000,
		draft: false,
		is_queued: false,
		unaddressed_comment_count: 0,
		merge_readiness_status: null,
		merge_readiness_action: null,
		merge_readiness_blockers: null,
		merge_readiness_warnings: null,
		readiness_source_head_sha: null,
		merge_group_sha: null,
		required_checks_policy_known: null,
		required_reviews_policy_known: null,
		merge_queue_required: null,
		merge_queue_state: null,
		readiness_updated_at: null,
	};

	it("resolves relative PR comment image sources against the linked PR head commit", async () => {
		vi.mocked(getPrComments).mockResolvedValue([
			makeComment(1, 0, "![Screenshot](docs/review.png)"),
		]);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		const { container } = render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(container.querySelector("img")?.getAttribute("src")).toBe("https://raw.githubusercontent.com/acme/repo/abc/docs/review.png");
		});
	});

	it("addressed comments hidden by default", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed
			makeComment(2, 1), // addressed
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			// Unaddressed comment should be visible
			expect(screen.getByText("Comment 1")).toBeTruthy();
			// Addressed comment should NOT be in DOM
			expect(screen.queryByText("Comment 2")).toBeNull();
		});
	});

	it("keeps failed Review comment addressing visible and retryable", async () => {
		const comment = makeComment(7, 0, "Review retry comment");
		vi.mocked(getPrComments).mockResolvedValue([comment]);
		vi.mocked(markCommentAddressed)
			.mockRejectedValueOnce(new Error("review address failed"))
			.mockResolvedValueOnce(undefined);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await fireEvent.click(await screen.findByRole("button", { name: /mark addressed/i }));

		await waitFor(() => {
			expect(screen.getByText("Review retry comment")).toBeTruthy();
			expect(screen.getByRole("alert").textContent).toContain("review address failed");
			expect(screen.getByRole("button", { name: "Retry mark addressed" })).toBeTruthy();
		});

		await fireEvent.click(screen.getByRole("button", { name: "Retry mark addressed" }));

		await waitFor(() => {
			expect(markCommentAddressed).toHaveBeenCalledTimes(2);
			expect(screen.queryByText("Review retry comment")).toBeNull();
			expect(screen.queryByRole("alert")).toBeNull();
		});
	});

	it("toggle shows addressed comments", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed
			makeComment(2, 1), // addressed
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		// Find and click the toggle button
		const toggleButton = screen.getByText(/Show 1 addressed/);
		expect(toggleButton).toBeTruthy();
		toggleButton.click();

		await waitFor(() => {
			// Now addressed comment should be visible
			expect(screen.getByText("Comment 2")).toBeTruthy();
			// Toggle text should change
			expect(screen.getByText("Hide addressed")).toBeTruthy();
		});
	});

	it("toggle hidden when no addressed comments", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed only
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		// Toggle button should not exist
		expect(screen.queryByText(/Show.*addressed/)).toBeNull();
	});

	it("all addressed empty state", async () => {
		const comments = [
			makeComment(1, 1), // addressed only
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		// Feedback stays visible in the normal review flow even when every comment is addressed.
		await waitFor(() => {
			expect(screen.getByRole('region', { name: 'Feedback panel' })).toBeTruthy();
		});

		await waitFor(() => {
			// Should show "All comments addressed" empty state
			expect(screen.getByText("All comments addressed")).toBeTruthy();
			// Comment should not be visible (toggle is OFF by default)
			expect(screen.queryByText("Comment 1")).toBeNull();
		});
	});

	it("feedback panel renders inside a resizable 380px panel", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed — triggers auto-open
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		render(SelfReviewView, {
			props: {
				task: baseTask,
				agentStatus: null,
				onSendToAgent: vi.fn(),
			},
		});

		await waitFor(() => {
			// Sidebar should auto-open due to unaddressed comment
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		const prCommentsTab = screen.getByText("PR Comments");
		const resizablePanel = requireElement(
			prCommentsTab.closest('[data-testid="resizable-panel"]'),
			HTMLElement,
		);
		expect(resizablePanel).toBeTruthy();
		expect(resizablePanel.style.width).toBe('380px');
	});
});

describe("SelfReviewView — non-application file filter", () => {
	const appFile: PrFileDiff = { ...baseDiff, filename: "src/main.rs", sha: "app-sha" };
	const docFile: PrFileDiff = { ...baseDiff, filename: "README.md", sha: "doc-sha" };
	const mdxFile: PrFileDiff = { ...baseDiff, filename: "docs/guide.mdx", sha: "mdx-sha" };

	beforeEach(() => {
		clearTaskReviewPaneState();
		selfReviewStateByTask.set(new Map());
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
		vi.mocked(getTaskBatchFileContents).mockImplementation(
			async (_taskId, files) => files.map(() => ["", ""] as [string, string]),
		);
	});

	it("shows every file by default and hides non-application files when the toggle is deselected", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([appFile, docFile]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		// Both files are shown by default; the file-tree toggle is selected.
		await screen.findByLabelText("Mark src/main.rs reviewed");
		expect(screen.getByLabelText("Mark README.md reviewed")).toBeTruthy();
		const toggle = requireElement(
			screen.getByRole("checkbox", { name: /Also include non-application files/i }),
			HTMLInputElement,
		);
		expect(toggle.checked).toBe(true);

		// Deselecting hides the non-application file and reports the hidden count.
		await fireEvent.click(toggle);

		await waitFor(() => {
			expect(screen.queryByLabelText("Mark README.md reviewed")).toBeNull();
			expect(screen.getByLabelText("Mark src/main.rs reviewed")).toBeTruthy();
		});
		expect(screen.getByText("(1 hidden)")).toBeTruthy();
	});

	it("offers a reveal action once deselecting hides every changed file", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([docFile, mdxFile]);

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		// Both non-application files show by default.
		await screen.findByLabelText("Mark README.md reviewed");

		// Deselecting the toggle hides everything and surfaces the empty-state explanation.
		await fireEvent.click(
			requireElement(
				screen.getByRole("checkbox", { name: /Also include non-application files/i }),
				HTMLInputElement,
			),
		);
		await screen.findByText("Only non-application files changed");

		// The empty-state action brings them back.
		await fireEvent.click(screen.getByRole("button", { name: "Show non-application files" }));

		await waitFor(() => {
			expect(screen.getByLabelText("Mark README.md reviewed")).toBeTruthy();
			expect(screen.getByLabelText("Mark docs/guide.mdx reviewed")).toBeTruthy();
		});
	});
});

describe('SelfReviewView Rich Diff repository paths', () => {
  beforeEach(() => {
    clearTaskReviewPaneState();
    selfReviewStateByTask.set(new Map());
    pendingManualComments.set([]);
    ticketPrs.set(new Map());
    vi.clearAllMocks();
    globalThis.Worker = InlineDiffWorker as unknown as typeof Worker;
  });

  it('loads nested worktree images and reveals relative links in the file viewer', async () => {
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/guides/README.md', sha: 'docs-sha' };
    vi.mocked(getTaskDiff).mockResolvedValue([markdownFile]);
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([[
      '',
      '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md)',
    ]]);
    vi.mocked(getTaskFileContents).mockResolvedValue(['', 'base64-diagram']);

    render(SelfReviewView, {
      props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
    });

    await fireEvent.click(await screen.findByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }));

    await waitFor(() => {
      expect(getTaskFileContents).toHaveBeenCalledWith(
        baseTask.id,
        'docs/assets/diagram.png',
        null,
        'modified',
        true,
        true,
      );
      expect(screen.getByRole('img', { name: 'Diagram' }).getAttribute('src'))
        .toBe('data:image/png;base64,base64-diagram');
    });

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }));
    expect(revealFileInFileViewer).toHaveBeenCalledWith('docs/SETUP.md');
    expect(navigateMock).toHaveBeenCalledWith(FILE_VIEWER_VIEW_KEY);
  });
});
