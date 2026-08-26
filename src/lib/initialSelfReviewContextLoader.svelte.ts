import { get } from "svelte/store";
import { getPrComments } from "./ipc";
import { ticketPrs } from "./stores";
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

	async function loadLinkedPrComments(
		taskId: string,
		requestGeneration: number,
	): Promise<void> {
		if (isStale(requestGeneration)) return;
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

	async function hydrate(taskId: string): Promise<void> {
		const requestGeneration = ++generation;
		linkedPr = null;
		prComments = [];
		await loadLinkedPrComments(taskId, requestGeneration);
	}

	function cleanup(_taskId: string): void {
		invalidate();
		prComments = [];
		linkedPr = null;
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
