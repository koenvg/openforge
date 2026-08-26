import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialSelfReviewContextLoader } from "./initialSelfReviewContextLoader.svelte";
import * as ipc from "./ipc";
import { ticketPrs } from "./stores";
import {
	getPendingSelfReviewComments,
	selfReviewStateByTask,
	setPendingSelfReviewComments,
} from "./taskScopedSelfReviewState";
import type { PrComment, PullRequestInfo } from "./types";

vi.mock("./ipc", () => ({
  getPrComments: vi.fn(),
}));

const mockGetPrComments = vi.mocked(ipc.getPrComments);

const olderOpenPr = {
	id: 10,
	pr_number: 10,
	ticket_id: "task-1",
	title: "Older PR",
	url: "https://github.com/org/repo/pull/10",
	state: "open",
	updated_at: 1_700_000_000,
} as PullRequestInfo;

const newestOpenPr = {
	...olderOpenPr,
	id: 11,
	pr_number: 11,
	title: "Newest PR",
	url: "https://github.com/org/repo/pull/11",
	updated_at: 1_700_000_200,
};

const prComment = {
	id: 20,
	pr_id: newestOpenPr.id,
	author: "reviewer",
	body: "Please adjust this",
	comment_type: "inline",
	file_path: "src/main.rs",
	line_number: 12,
	addressed: 0,
	outdated: 0,
	created_at: 1_700_000_300,
} as PrComment;

describe("createInitialSelfReviewContextLoader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selfReviewStateByTask.set(new Map());
		ticketPrs.set(new Map());
		mockGetPrComments.mockResolvedValue([]);
	});

	it("hydrates comments for the newest open linked pull request", async () => {
		ticketPrs.set(new Map([["task-1", [olderOpenPr, newestOpenPr]]]));
		mockGetPrComments.mockResolvedValue([prComment]);
		const loader = createInitialSelfReviewContextLoader();

		await loader.hydrate("task-1");

		expect(mockGetPrComments).toHaveBeenCalledWith(newestOpenPr.id);
		expect(loader.linkedPr).toEqual(newestOpenPr);
		expect(loader.prComments).toEqual([prComment]);
	});

	it("ignores pull request comments from an earlier hydration", async () => {
		let resolveFirst!: (comments: PrComment[]) => void;
		mockGetPrComments.mockReturnValue(
			new Promise((resolve) => {
				resolveFirst = resolve;
			}),
		);
		ticketPrs.set(new Map([["task-1", [newestOpenPr]]]));
		const loader = createInitialSelfReviewContextLoader();

		const firstHydration = loader.hydrate("task-1");
		await vi.waitFor(() => {
			expect(mockGetPrComments).toHaveBeenCalledWith(newestOpenPr.id);
		});
		await loader.hydrate("task-2");
		resolveFirst([prComment]);
		await firstHydration;

		expect(loader.linkedPr).toBeNull();
		expect(loader.prComments).toEqual([]);
	});

	it("preserves pending line-by-line feedback while hydrating and cleaning up", async () => {
		const pendingComment = {
			path: "src/main.rs",
			line: 12,
			side: "RIGHT" as const,
			body: "Keep this feedback",
		};
		setPendingSelfReviewComments("task-1", [pendingComment]);
		const loader = createInitialSelfReviewContextLoader();

		await loader.hydrate("task-1");
		loader.cleanup("task-1");

		expect(getPendingSelfReviewComments("task-1")).toEqual([pendingComment]);
		expect(loader.linkedPr).toBeNull();
		expect(loader.prComments).toEqual([]);
	});

	it("clears PR comments when loading them fails", async () => {
		ticketPrs.set(new Map([["task-1", [newestOpenPr]]]));
		mockGetPrComments.mockRejectedValue(new Error("network failed"));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		const loader = createInitialSelfReviewContextLoader();

		await loader.hydrate("task-1");

		expect(loader.linkedPr).toEqual(newestOpenPr);
		expect(loader.prComments).toEqual([]);
		expect(errorSpy).toHaveBeenCalled();
		errorSpy.mockRestore();
	});
});
