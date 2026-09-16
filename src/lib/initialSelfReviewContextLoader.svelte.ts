import { get } from "svelte/store";
import { getConfig, getPrComments } from "./ipc";
import { ticketPrs } from "./stores";
import type { PrComment, PullRequestInfo } from "./types";

export interface InitialSelfReviewContextLoader {
	readonly prComments: PrComment[];
	readonly linkedPr: PullRequestInfo | null;
	readonly githubUsername: string | null;
	hydrate(taskId: string): Promise<void>;
	invalidate(): void;
	cleanup(taskId: string): void;
}

export function createInitialSelfReviewContextLoader(): InitialSelfReviewContextLoader {
	let prComments = $state<PrComment[]>([]);
	let linkedPr = $state<PullRequestInfo | null>(null);
	let githubUsername = $state<string | null>(null);
	let generation = 0;

	function invalidate(): void {
		generation += 1;
	}

	function isStale(requestGeneration: number): boolean {
		return requestGeneration !== generation;
	}

	async function loadLinkedPrComments(taskId: string): Promise<PrComment[]> {
		const openPrs = (get(ticketPrs).get(taskId) ?? [])
			.filter((pr) => pr.state === "open")
			.sort((a, b) => b.updated_at - a.updated_at);
		if (openPrs.length === 0) return [];

		const pr = openPrs[0];
		linkedPr = pr;
		try {
			return await getPrComments(pr.id);
		} catch (error) {
			console.error(`Failed to load comments for PR ${pr.id}:`, error);
			return [];
		}
	}

	async function hydrate(taskId: string): Promise<void> {
		const requestGeneration = ++generation;
		linkedPr = null;
		prComments = [];
		githubUsername = null;
		const [nextGithubUsername, nextPrComments] = await Promise.all([
			getConfig("github_username").catch(() => null),
			loadLinkedPrComments(taskId),
		]);
		if (isStale(requestGeneration)) return;
		githubUsername = nextGithubUsername;
		prComments = nextPrComments;
	}

	function cleanup(_taskId: string): void {
		invalidate();
		prComments = [];
		linkedPr = null;
		githubUsername = null;
	}

	return {
		get prComments() {
			return prComments;
		},
		get linkedPr() {
			return linkedPr;
		},
		get githubUsername() {
			return githubUsername;
		},
		hydrate,
		invalidate,
		cleanup,
	};
}
