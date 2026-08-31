import {
	baseDiff,
	baseTask,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import {
	getCommitDiff,
	getTaskBatchFileContents,
	getTaskCommits,
	getTaskDiff,
} from "../../lib/ipc";
import { getTaskReviewPaneState } from "../../lib/taskReviewPaneState";

setupSelfReviewViewTestSuite();

describe("SelfReviewView pane restoration", () => {
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

		const firstRender = renderSelfReviewView();

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

		renderSelfReviewView();

		await waitFor(() => {
			expect(screen.getByText("Show all changes")).toBeTruthy();
			expect(getCommitDiff).toHaveBeenCalledWith(baseTask.id, commit.sha);
		});
	});

	it("restores the diff scroll position when the review pane is remounted for the same task", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([{ oldContent: "", newContent: "" }]);

		const firstRender = renderSelfReviewView();

		let scrollArea!: HTMLElement;
		await waitFor(() => {
			scrollArea = requireElement(screen.getByRole("region", { name: "Diff scroll area" }), HTMLElement);
		});
		Object.defineProperty(scrollArea, "scrollTop", { value: 184, writable: true, configurable: true });
		await fireEvent.scroll(scrollArea);
		expect(getTaskReviewPaneState(baseTask.id).diffScrollTop).toBe(184);

		firstRender.unmount();

		renderSelfReviewView();

		await waitFor(() => {
			const restoredScrollArea = requireElement(screen.getByRole("region", { name: "Diff scroll area" }), HTMLElement);
			expect(restoredScrollArea.scrollTop).toBe(184);
		});
	});


	it("hides and restores the full left pane while keeping reviewed file state synced", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([{ oldContent: "", newContent: "" }]);

		renderSelfReviewView();

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
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([{ oldContent: "", newContent: "" }]);

		renderSelfReviewView();

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
