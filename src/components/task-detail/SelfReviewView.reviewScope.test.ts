import {
	baseDiff,
	baseTask,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { createVirtualizer } from "@openforge-app/pr-review-ui/useVirtualizer.svelte";
import { describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import type { PrFileDiff } from "../../lib/types";
import {
	getActiveSelfReviewComments,
	getCommitDiff,
	getTaskBatchFileContents,
	getTaskCommits,
	getTaskDiff,
} from "../../lib/ipc";

setupSelfReviewViewTestSuite();

describe("SelfReviewView uncommitted toggle", () => {
	it("defaults to both committed and uncommitted checked", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

		await waitFor(() => {
			const committed = requireElement(screen.getByLabelText("Include committed changes"), HTMLInputElement);
			const uncommitted = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
			expect(committed.checked).toBe(true);
			expect(uncommitted.checked).toBe(true);
		});
	});

	it("leaves both checkboxes unlocked when both scopes are selected by default", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

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

		renderSelfReviewView();

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, true);
		});
	});

	it("toggle visible even with no diff files (empty state)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([]);

		renderSelfReviewView();

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

		renderSelfReviewView();

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

		renderSelfReviewView();

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
		const commit = {
			sha: "commit-sha",
			short_sha: "commit",
			message: "Review this commit",
			author: "dev",
			date: "2025-01-01T00:00:00Z",
		};
		const commitDiff = { ...baseDiff, filename: "src/only-commit.rs" };
		const mockGetTaskDiff = vi.mocked(getTaskDiff);
		const mockGetTaskCommits = vi.mocked(getTaskCommits);
		const mockGetCommitDiff = vi.mocked(getCommitDiff);

		mockGetTaskDiff.mockResolvedValue([baseDiff]);
		mockGetTaskCommits.mockResolvedValue([commit]);
		mockGetCommitDiff.mockResolvedValue([commitDiff]);

		renderSelfReviewView();

		await fireEvent.click(await screen.findByTitle(commit.message));

		await waitFor(() => {
			expect(mockGetCommitDiff).toHaveBeenCalledWith(baseTask.id, commit.sha);
			expect(screen.queryByLabelText("Include uncommitted changes")).toBeNull();
			expect(screen.getByText("Show all changes")).toBeTruthy();
		});
	});
});

describe('SelfReviewView review workspace', () => {
	it('presents Changed files, Code diff, and Feedback as the primary review regions', async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

		expect(await screen.findByRole('region', { name: 'Changed files panel' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Code diff panel' })).toBeTruthy();
		expect(screen.getByRole('region', { name: 'Feedback panel' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse Changed files panel' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Collapse Feedback panel' })).toBeTruthy();
	});

	it('moves keyboard focus between the Review File Tree and diff with Tab and Shift+Tab', async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

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

		renderSelfReviewView();

		expect(await screen.findByLabelText('Mark src/main.rs reviewed')).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Mark selected file reviewed' })).toBeNull();
	});
});


describe("SelfReviewView integration — performance fixes", () => {
	it("commit history pane remains visible while loading diffs", async () => {
		// Start with a mock that won't resolve immediately
		let resolveTaskDiff: (val: PrFileDiff[]) => void = () => {};
		const diffPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveTaskDiff = resolve;
		});
		vi.mocked(getTaskDiff).mockReturnValue(diffPromise);

		renderSelfReviewView();

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

		renderSelfReviewView();

		await waitFor(() => {
			expect(mockGetTaskDiff).toHaveBeenCalledTimes(1);
			expect(mockGetTaskDiff).toHaveBeenCalledWith("task-1", true, true);
		});
	});

	it("getActiveSelfReviewComments called exactly once on mount", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		const mockGetActiveComments = vi.mocked(getActiveSelfReviewComments);

		renderSelfReviewView();

		await waitFor(() => {
			expect(mockGetActiveComments).toHaveBeenCalledTimes(1);
			expect(mockGetActiveComments).toHaveBeenCalledWith("task-1");
		});
	});

	it("DiffViewer toolbar visible after toggle (DiffViewer successfully re-mounted)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		renderSelfReviewView();

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

		renderSelfReviewView();

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
