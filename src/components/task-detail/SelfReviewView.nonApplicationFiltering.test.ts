import {
	baseDiff,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireElement } from "../../test-utils/dom";
import type { PrFileDiff } from "../../lib/types";
import { getTaskBatchFileContents, getTaskDiff } from "../../lib/ipc";

setupSelfReviewViewTestSuite();

describe("SelfReviewView — non-application file filter", () => {
	const appFile: PrFileDiff = { ...baseDiff, filename: "src/main.rs", sha: "app-sha" };
	const docFile: PrFileDiff = { ...baseDiff, filename: "README.md", sha: "doc-sha" };
	const mdxFile: PrFileDiff = { ...baseDiff, filename: "docs/guide.mdx", sha: "mdx-sha" };

	beforeEach(() => {
		vi.mocked(getTaskBatchFileContents).mockImplementation(
			async (_taskId, files) => files.map(() => ({ oldContent: "", newContent: "" })),
		);
	});
	it("shows every file by default and hides non-application files when the toggle is deselected", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([appFile, docFile]);

		renderSelfReviewView();

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

		renderSelfReviewView();

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
