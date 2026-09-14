import {
	baseDiff,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewThread } from "@openforge-app/plugin-sdk";
import { getTaskDiff, listReviewThreads, replyToReviewThread, setReviewThreadStatus } from "../../lib/ipc";

setupSelfReviewViewTestSuite();

const listMock = vi.mocked(listReviewThreads);
const replyMock = vi.mocked(replyToReviewThread);
const setStatusMock = vi.mocked(setReviewThreadStatus);

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
	return {
		id: "rt_1",
		namespace: "task",
		targetKey: "task-1",
		revision: "working-tree",
		anchor: { kind: "line", filePath: "src/gone.rs", line: 2, side: "RIGHT" },
		origin: "agent",
		status: "open",
		awaiting: "none",
		runId: null,
		idempotencyKey: null,
		seenAt: null,
		hasUnreadAgentMessage: false,
		createdAt: 1,
		updatedAt: 1,
		messages: [{ id: "rtm_1", role: "agent", body: "Needs a null check", createdAt: 1 }],
		...overrides,
	};
}

describe("SelfReviewView review threads", () => {
	beforeEach(() => {
		vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
		listMock.mockResolvedValue([makeThread()]);
	});

	it("reads the reviewed task's threads at the working-tree revision", async () => {
		renderSelfReviewView();

		await waitFor(() => {
			expect(listMock).toHaveBeenCalledWith({
				namespace: "task",
				targetKey: "task-1",
				revision: "working-tree",
			});
		});
	});

	it("shows a thread the host returns whose anchor is outside the reviewed diff", async () => {
		renderSelfReviewView();

		expect(await screen.findByText("Needs a null check")).toBeTruthy();
	});

	it("sends a reviewer reply to the host", async () => {
		replyMock.mockResolvedValue(makeThread());
		renderSelfReviewView();

		const editor = await screen.findByRole("textbox", { name: "Reply to the review thread" });
		await fireEvent.input(editor, { target: { value: "Fixed in the next commit" } });
		await fireEvent.click(screen.getByRole("button", { name: "Reply" }));

		await waitFor(() => {
			expect(replyMock).toHaveBeenCalledWith({
				threadId: "rt_1",
				role: "human",
				body: "Fixed in the next commit",
			});
		});
	});

	it("sends a resolve decision to the host", async () => {
		setStatusMock.mockResolvedValue(makeThread({ status: "resolved" }));
		renderSelfReviewView();

		await fireEvent.click(await screen.findByRole("button", { name: "Resolve review thread" }));

		await waitFor(() => {
			expect(setStatusMock).toHaveBeenCalledWith({ threadId: "rt_1", status: "resolved" });
		});
	});
});
