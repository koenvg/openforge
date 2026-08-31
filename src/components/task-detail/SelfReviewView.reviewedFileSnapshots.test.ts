import {
	baseDiff,
	baseTask,
	InlineDiffWorker,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import {
	getTaskBatchFileContents,
	getTaskDiff,
	getTaskFileContents,
} from "../../lib/ipc";
import {
	getTaskReviewFileIdentity,
	getTaskReviewPaneState,
	markTaskReviewFileReviewed,
} from "../../lib/taskReviewPaneState";

setupSelfReviewViewTestSuite();

describe("SelfReviewView reviewed file snapshots", () => {
	it("marks a file reviewed from the diff header while keeping the file tree row in place", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([{ oldContent: "", newContent: "" }]);

		renderSelfReviewView();

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
		vi.mocked(getTaskFileContents).mockResolvedValue({ oldContent: "base content\n", newContent: "reviewed content\n" });
		vi.mocked(getTaskBatchFileContents).mockResolvedValue([{ oldContent: "base content\n", newContent: "changed content\n" }]);

		const firstRender = renderSelfReviewView();

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

		const currentRender = renderSelfReviewView();

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

		renderSelfReviewView();

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

		const firstRender = renderSelfReviewView();

		await screen.findByLabelText("Mark src/main.rs reviewed");
		markTaskReviewFileReviewed(baseTask.id, baseDiff);
		firstRender.unmount();

		const secondRender = renderSelfReviewView();

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});

		secondRender.unmount();
		mockGetTaskDiff.mockResolvedValue([{ ...baseDiff, sha: "changed-sha" }]);

		renderSelfReviewView();

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

		const firstRender = renderSelfReviewView();

		await fireEvent.click(await screen.findByLabelText("Mark src/main.rs reviewed"));

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(true);
			expect(screen.getByLabelText("Reviewed file src/main.rs")).toBeTruthy();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});

		firstRender.unmount();

		const secondRender = renderSelfReviewView();

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

		renderSelfReviewView();

		await waitFor(() => {
			const checkbox = requireElement(screen.getByLabelText("Mark src/main.rs reviewed"), HTMLInputElement);
			expect(checkbox.checked).toBe(false);
			expect(screen.queryByLabelText("Reviewed file src/main.rs")).toBeNull();
			expect(screen.queryByRole("button", { name: "Reviewed files (1)" })).toBeNull();
			expect(screen.queryByText("1 reviewed hidden")).toBeNull();
		});
	});
});
