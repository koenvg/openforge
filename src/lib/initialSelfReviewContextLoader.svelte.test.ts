import { writable } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
	PrComment,
	PullRequestInfo,
	SelfReviewComment,
} from "./types";

vi.mock("./stores", () => ({
	ticketPrs: writable<Map<string, PullRequestInfo[]>>(new Map()),
}));

vi.mock("./ipc", () => ({
	getActiveSelfReviewComments:
		vi.fn<(taskId: string) => Promise<SelfReviewComment[]>>(),
	getArchivedSelfReviewComments:
		vi.fn<(taskId: string) => Promise<SelfReviewComment[]>>(),
	getPrComments: vi.fn<(prId: number) => Promise<PrComment[]>>(),
}));

import { createInitialSelfReviewContextLoader } from "./initialSelfReviewContextLoader.svelte";
import * as ipc from "./ipc";
import { ticketPrs } from "./stores";
import {
	getPendingSelfReviewComments,
	getSelfReviewArchivedComments,
	getSelfReviewGeneralComments,
	selfReviewStateByTask,
	setPendingSelfReviewComments,
} from "./taskScopedSelfReviewState";

const mockGetActiveSelfReviewComments = vi.mocked(
	ipc.getActiveSelfReviewComments,
);
const mockGetArchivedSelfReviewComments = vi.mocked(
	ipc.getArchivedSelfReviewComments,
);
const mockGetPrComments = vi.mocked(ipc.getPrComments);

const generalComment: SelfReviewComment = {
	id: 1,
	task_id: "task-1",
	round: 1,
	comment_type: "general",
	file_path: null,
	line_number: null,
	body: "General note",
	created_at: 1700000000,
	archived_at: null,
};

const inlineComment: SelfReviewComment = {
	...generalComment,
	id: 2,
	comment_type: "inline",
	file_path: "src/main.rs",
	line_number: 12,
	body: "Check this line",
};

const archivedComment: SelfReviewComment = {
	...generalComment,
	id: 3,
	body: "Old note",
	archived_at: 1700000100,
};

const olderOpenPr: PullRequestInfo = {
	id: 10,
	pr_number: 10,
	ticket_id: "task-1",
	repo_owner: "org",
	repo_name: "repo",
	title: "Older PR",
	url: "https://github.com/org/repo/pull/10",
	state: "open",
	head_sha: "abc",
	ci_status: null,
	ci_check_runs: null,
	review_status: null,
	mergeable: null,
	mergeable_state: null,
	merged_at: null,
	created_at: 1700000000,
	updated_at: 1700000000,
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

const newestOpenPr: PullRequestInfo = {
	...olderOpenPr,
	id: 11,
	pr_number: 11,
	title: "Newest PR",
	url: "https://github.com/org/repo/pull/11",
	updated_at: 1700000200,
};

const prComment: PrComment = {
	id: 20,
	pr_id: newestOpenPr.id,
	author: "reviewer",
	body: "Please adjust this",
	comment_type: "inline",
	file_path: "src/main.rs",
	line_number: 12,
	addressed: 0,
	outdated: 0,
	created_at: 1700000300,
};

describe("createInitialSelfReviewContextLoader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		selfReviewStateByTask.set(new Map());
		ticketPrs.set(new Map());
		mockGetActiveSelfReviewComments.mockResolvedValue([]);
		mockGetArchivedSelfReviewComments.mockResolvedValue([]);
		mockGetPrComments.mockResolvedValue([]);
	});

	it("hydrates review comments and the newest open linked pull request", async () => {
		const localPendingComment = {
			path: "src/local.ts",
			line: 7,
			side: "RIGHT" as const,
			body: "Keep local feedback",
		};
		setPendingSelfReviewComments("task-1", [localPendingComment]);
		mockGetActiveSelfReviewComments.mockResolvedValue([
			generalComment,
			inlineComment,
		]);
		mockGetArchivedSelfReviewComments.mockResolvedValue([archivedComment]);
		mockGetPrComments.mockResolvedValue([prComment]);
		ticketPrs.set(
			new Map([
				[
					"task-1",
					[
						olderOpenPr,
						{ ...newestOpenPr, state: "closed" },
						newestOpenPr,
					],
				],
			]),
		);
		const loader = createInitialSelfReviewContextLoader();

		await loader.hydrate("task-1");

		expect(getSelfReviewGeneralComments("task-1")).toEqual([generalComment]);
		expect(getSelfReviewArchivedComments("task-1")).toEqual([
			archivedComment,
		]);
		expect(getPendingSelfReviewComments("task-1")).toEqual([
			{
				path: "src/main.rs",
				line: 12,
				body: "Check this line",
				side: "RIGHT",
			},
			localPendingComment,
		]);
		expect(loader.linkedPr).toEqual(newestOpenPr);
		expect(loader.prComments).toEqual([prComment]);
		expect(mockGetPrComments).toHaveBeenCalledWith(newestOpenPr.id);
	});

	it("loads self-review comments before linked pull request comments", async () => {
		const calls: string[] = [];
		mockGetActiveSelfReviewComments.mockImplementation(async () => {
			calls.push("active self-review comments");
			return [];
		});
		mockGetArchivedSelfReviewComments.mockImplementation(async () => {
			calls.push("archived self-review comments");
			return [];
		});
		mockGetPrComments.mockImplementation(async () => {
			calls.push("linked pull request comments");
			return [];
		});
		ticketPrs.set(new Map([["task-1", [newestOpenPr]]]));
		const loader = createInitialSelfReviewContextLoader();

		await loader.hydrate("task-1");

		expect(calls).toEqual([
			"active self-review comments",
			"archived self-review comments",
			"linked pull request comments",
		]);
	});

	it("ignores an earlier hydration after a later request starts", async () => {
		let resolveFirst!: (comments: SelfReviewComment[]) => void;
		mockGetActiveSelfReviewComments
			.mockReturnValueOnce(
				new Promise((resolve) => {
					resolveFirst = resolve;
				}),
			)
			.mockResolvedValueOnce([
				{ ...generalComment, task_id: "task-2", body: "Task two" },
			]);
		const loader = createInitialSelfReviewContextLoader();

		const firstHydration = loader.hydrate("task-1");
		await loader.hydrate("task-2");
		resolveFirst([generalComment]);
		await firstHydration;

		expect(getSelfReviewGeneralComments("task-1")).toEqual([]);
		expect(getSelfReviewGeneralComments("task-2")).toEqual([
			{ ...generalComment, task_id: "task-2", body: "Task two" },
		]);
	});

	it("clears pull request context when a newer hydration has no open pull request", async () => {
		let resolvePrComments!: (comments: PrComment[]) => void;
		mockGetPrComments.mockReturnValue(
			new Promise((resolve) => {
				resolvePrComments = resolve;
			}),
		);
		ticketPrs.set(new Map([["task-1", [newestOpenPr]]]));
		const loader = createInitialSelfReviewContextLoader();

		const firstHydration = loader.hydrate("task-1");
		await vi.waitFor(() => {
			expect(mockGetPrComments).toHaveBeenCalledWith(newestOpenPr.id);
		});
		await loader.hydrate("task-2");
		resolvePrComments([prComment]);
		await firstHydration;

		expect(loader.linkedPr).toBeNull();
		expect(loader.prComments).toEqual([]);
	});

	it("clears loaded context while preserving pending inline feedback", async () => {
		const pendingComment = {
			path: "src/main.rs",
			line: 12,
			side: "RIGHT" as const,
			body: "Keep this feedback",
		};
		mockGetActiveSelfReviewComments.mockResolvedValue([generalComment]);
		mockGetArchivedSelfReviewComments.mockResolvedValue([archivedComment]);
		setPendingSelfReviewComments("task-1", [pendingComment]);
		const loader = createInitialSelfReviewContextLoader();
		await loader.hydrate("task-1");

		loader.cleanup("task-1");

		expect(getSelfReviewGeneralComments("task-1")).toEqual([]);
		expect(getSelfReviewArchivedComments("task-1")).toEqual([]);
		expect(getPendingSelfReviewComments("task-1")).toEqual([pendingComment]);
		expect(loader.linkedPr).toBeNull();
		expect(loader.prComments).toEqual([]);
	});
});
