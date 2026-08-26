import {
	baseDiff,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { createVirtualizer } from "@openforge-app/pr-review-ui/useVirtualizer.svelte";
import { describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import type { PrFileDiff } from "../../lib/types";
import {
  getCommitDiff,
  getTaskBatchFileContents,
  getTaskCommits,
  getTaskDiff,
} from "../../lib/ipc";

setupSelfReviewViewTestSuite();

describe("SelfReviewView integration performance", () => {
	it("commit history pane remains visible while loading diffs", async () => {
		let resolveTaskDiff: (val: PrFileDiff[]) => void = () => {};
		const diffPromise = new Promise<PrFileDiff[]>((resolve) => {
			resolveTaskDiff = resolve;
		});
		vi.mocked(getTaskDiff).mockReturnValue(diffPromise);

		renderSelfReviewView();

		await screen.findByText("Loading diff...");

		expect(screen.getByText("Scope")).toBeTruthy();
		expect(screen.getByText("Changed files")).toBeTruthy();

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


	it("DiffViewer toolbar visible after toggle (DiffViewer successfully re-mounted)", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([["", ""]]);

		renderSelfReviewView();

		await waitFor(() => {
			expect(screen.getByTitle("Search (⌘F)")).toBeTruthy();
		});

		const cb = requireElement(screen.getByLabelText("Include uncommitted changes"), HTMLInputElement);
		cb.click();
		cb.dispatchEvent(new Event("change", { bubbles: true }));

		await waitFor(
			() => {
				expect(screen.getByTitle("Search (⌘F)")).toBeTruthy();
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
