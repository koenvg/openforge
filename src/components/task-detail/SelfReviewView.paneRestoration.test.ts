import {
	baseDiff,
	baseTask,
	InlineDiffWorker,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import {
	getCommitDiff,
	getTaskBatchFileContents,
	getTaskCommits,
	getTaskDiff,
	getTaskFileContents,
} from "../../lib/ipc";
import {
	getTaskReviewFileIdentity,
	getTaskReviewPaneState,
	markTaskReviewFileReviewed,
} from "../../lib/taskReviewPaneState";
import SelfReviewView from "./SelfReviewView.svelte";

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

	it("shows an error when the Reviewed File Snapshot comparison cannot be loaded", async () => {
		markTaskReviewFileReviewed(
			baseTask.id,
			{ ...baseDiff, sha: "reviewed-sha" },
			{ newContent: "reviewed content\n" },
		);
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockRejectedValue(new Error("content load failed"));

		render(SelfReviewView, {
			props: { task: baseTask, agentStatus: null, onSendToAgent: vi.fn() },
		});

		await fireEvent.click(await screen.findByRole("button", {
			name: "Compare src/main.rs with Reviewed File Snapshot",
		}));

		await waitFor(() => {
			expect(screen.getByRole("alert").textContent).toContain(
				"Couldn't compare src/main.rs with its Reviewed File Snapshot. Try the Since reviewed action again.",
			);
		});
	});

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
