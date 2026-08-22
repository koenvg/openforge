import {
	baseDiff,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen } from "@testing-library/svelte";
import { describe, expect, it, vi } from "vitest";
import { getTaskDiff } from "../../lib/ipc";

setupSelfReviewViewTestSuite();

describe("SelfReviewView review workspace", () => {
	it("presents Changed files, Code diff, and Feedback as the primary review regions", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

		expect(await screen.findByRole("region", { name: "Changed files panel" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "Code diff panel" })).toBeTruthy();
		expect(screen.getByRole("region", { name: "Feedback panel" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Collapse Changed files panel" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Collapse Feedback panel" })).toBeTruthy();
	});

	it("moves keyboard focus between the Review File Tree and diff with Tab and Shift+Tab", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

		const tree = await screen.findByRole("tree", { name: "Changed files" });
		const diff = await screen.findByRole("region", { name: "Diff scroll area" });
		tree.focus();
		await fireEvent.keyDown(tree, { key: "Tab" });
		expect(document.activeElement).toBe(diff);

		await fireEvent.keyDown(diff, { key: "Tab", shiftKey: true });
		expect(document.activeElement).toBe(tree);
	});

	it("keeps mark-reviewed controls on diff file sections without a duplicate selected-file bar", async () => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

		expect(await screen.findByLabelText("Mark src/main.rs reviewed")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Mark selected file reviewed" })).toBeNull();
	});
});
