import {
	baseDiff,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrComment, PullRequestInfo } from "../../lib/types";
import {
	getPrComments,
	getTaskDiff,
	markCommentAddressed,
	resolveGithubAsset,
} from "../../lib/ipc";
import { ticketPrs } from "../../lib/stores";
import { setSelfReviewDiffFiles } from "../../lib/taskScopedSelfReviewState";

setupSelfReviewViewTestSuite();

describe("SelfReviewView — hide addressed comments", () => {
	beforeEach(() => {
		setSelfReviewDiffFiles("task-1", [baseDiff]);
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

	it("resolves GitHub upload URLs in PR comments through the sidecar", async () => {
		const uploadUrl = "https://github.com/user-attachments/assets/971f5efc-5e71-4d11-a2b5-daecad5323f3";
		const signedUrl = "https://private-user-images.githubusercontent.com/signed.png";
		vi.mocked(resolveGithubAsset).mockResolvedValue({ url: signedUrl, kind: "image" });
		vi.mocked(getPrComments).mockResolvedValue([
			makeComment(1, 0, `![Screenshot](${uploadUrl})`),
		]);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		const { container } = renderSelfReviewView();

		await waitFor(() => {
			expect(resolveGithubAsset).toHaveBeenCalledWith("acme", "repo", uploadUrl);
			expect(container.querySelector("img")?.getAttribute("src")).toBe(signedUrl);
		});
	});

	it("resolves relative PR comment image sources against the linked PR head commit", async () => {
		vi.mocked(getPrComments).mockResolvedValue([
			makeComment(1, 0, "![Screenshot](docs/review.png)"),
		]);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		const { container } = renderSelfReviewView();

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

		renderSelfReviewView();

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

		renderSelfReviewView();

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

		renderSelfReviewView();

		await waitFor(() => {
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		// Find and click the toggle button
		const toggleButton = screen.getByText(/Show 1 addressed/);
		expect(toggleButton).toBeTruthy();
		await fireEvent.click(toggleButton);

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

		renderSelfReviewView();

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

		renderSelfReviewView();

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

	it("feedback panel supports keyboard resizing", async () => {
		const comments = [
			makeComment(1, 0), // unaddressed — triggers auto-open
		];
		vi.mocked(getPrComments).mockResolvedValue(comments);
		ticketPrs.set(new Map([["task-1", [mockPr]]]));
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);

		renderSelfReviewView();

		await waitFor(() => {
			// Sidebar should auto-open due to unaddressed comment
			expect(screen.getByText("Comment 1")).toBeTruthy();
		});

		const resizeHandle = screen.getByRole("separator", { name: "Resize Feedback panel" });
		const initialWidth = Number(resizeHandle.getAttribute("aria-valuenow"));

		await fireEvent.keyDown(resizeHandle, { key: "ArrowLeft" });

		expect(Number(resizeHandle.getAttribute("aria-valuenow"))).toBe(initialWidth + 10);
	});
});
