import {
	baseDiff,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import {
	getCommitDiff,
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
			expect(mockGetCommitDiff).toHaveBeenCalledWith("task-1", commit.sha);
			expect(screen.queryByLabelText("Include uncommitted changes")).toBeNull();
			expect(screen.getByText("Show all changes")).toBeTruthy();
		});
	});
});
