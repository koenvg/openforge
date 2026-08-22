import { get } from "svelte/store";
import {
	getActiveSelfReviewComments,
	getArchivedSelfReviewComments,
	getPrComments,
} from "./ipc";
import { ticketPrs } from "./stores";
import {
	mergePendingSelfReviewComments,
	setSelfReviewArchivedComments,
	setSelfReviewGeneralComments,
} from "./taskScopedSelfReviewState";
import type { PrComment, PullRequestInfo } from "./types";

export interface InitialSelfReviewContextLoader {
	readonly prComments: PrComment[];
	readonly linkedPr: PullRequestInfo | null;
	hydrate(taskId: string): Promise<void>;
	invalidate(): void;
	cleanup(taskId: string): void;
}

export function createInitialSelfReviewContextLoader(): InitialSelfReviewContextLoader {
	let prComments = $state<PrComment[]>([]);
	let linkedPr = $state<PullRequestInfo | null>(null);
	let generation = 0;

	function invalidate(): void {
		generation += 1;
	}

	function isStale(requestGeneration: number): boolean {
		return requestGeneration !== generation;
	}

	async function hydrate(taskId: string): Promise<void> {
		const requestGeneration = ++generation;
		linkedPr = null;
		prComments = [];
		const activeComments = await getActiveSelfReviewComments(taskId);
		if (isStale(requestGeneration)) return;
		setSelfReviewGeneralComments(
			taskId,
			activeComments.filter((comment) => comment.comment_type === "general"),
		);

		const archivedComments = await getArchivedSelfReviewComments(taskId);
		if (isStale(requestGeneration)) return;
		setSelfReviewArchivedComments(
			taskId,
			archivedComments.filter((comment) => comment.comment_type === "general"),
		);

		mergePendingSelfReviewComments(
			taskId,
			activeComments
				.filter((comment) => comment.comment_type === "inline")
				.map((comment) => ({
					path: comment.file_path!,
					line: comment.line_number!,
					body: comment.body,
					side: "RIGHT",
				})),
		);

		const openPrs = (get(ticketPrs).get(taskId) ?? [])
			.filter((pr) => pr.state === "open")
			.sort((a, b) => b.updated_at - a.updated_at);
		if (openPrs.length === 0) return;

		const pr = openPrs[0];
		linkedPr = pr;
		try {
			const nextPrComments = await getPrComments(pr.id);
			if (isStale(requestGeneration)) return;
			prComments = nextPrComments;
		} catch (error) {
			if (isStale(requestGeneration)) return;
			console.error(`Failed to load comments for PR ${pr.id}:`, error);
			prComments = [];
		}
	}

	function cleanup(taskId: string): void {
		invalidate();
		prComments = [];
		linkedPr = null;
		setSelfReviewGeneralComments(taskId, []);
		setSelfReviewArchivedComments(taskId, []);
	}

	return {
		get prComments() {
			return prComments;
		},
		get linkedPr() {
			return linkedPr;
		},
		hydrate,
		invalidate,
		cleanup,
	};
}
