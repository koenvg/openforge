import { DiffFile } from "@git-diff-view/core";
import { highlighter } from "@git-diff-view/lowlight";
import { configureDiffHighlighter } from "@openforge-app/pr-review-ui/diffHighlightConfig";
import type { DiffWorkerRequest, DiffWorkerResponse } from "@openforge-app/pr-review-ui/diffWorker";
import { render } from "@testing-library/svelte";
import type { ComponentProps } from "svelte";
import { afterEach, beforeAll, beforeEach, vi } from "vitest";
import type { PrFileDiff, Task } from "../../lib/types";
import SelfReviewView from "./SelfReviewView.svelte";

vi.mock("../../lib/stores", async () => {
	const { writable } = await import("svelte/store");
	return {
	pendingManualComments: writable([]),
	ticketPrs: writable(new Map()),
	taskDraftNotes: writable(new Map()),
	};
});

vi.mock("@openforge-app/pr-review-ui/useVirtualizer.svelte", () => ({
	createVirtualizer: vi.fn((opts: { getCount: () => number }) => ({
		get virtualItems() {
			const count = opts.getCount();
			return Array.from({ length: count }, (_, i) => ({
				key: i,
				index: i,
				start: i * 300,
				end: (i + 1) * 300,
				size: 300,
				lane: 0,
			}));
		},
		totalSize: 0,
		scrollToIndex: vi.fn(),
		measureAction: () => ({ destroy() {} }),
	})),
}));

const ipcMocks = vi.hoisted(() => ({
	getTaskDiff: vi.fn().mockResolvedValue([]),
	getTaskCommits: vi.fn().mockResolvedValue([]),
	getCommitDiff: vi.fn().mockResolvedValue([]),
	getTaskFileContents: vi.fn().mockResolvedValue({ oldContent: "", newContent: "" }),
	getTaskBatchFileContents: vi.fn().mockResolvedValue([{ oldContent: "", newContent: "" }]),
	getCommitFileContents: vi.fn().mockResolvedValue({ oldContent: "", newContent: "" }),
	getCommitBatchFileContents: vi.fn().mockResolvedValue([{ oldContent: "", newContent: "" }]),
	getPrComments: vi.fn().mockResolvedValue([]),
	markCommentAddressed: vi.fn().mockResolvedValue(undefined),
	openUrl: vi.fn(),
	resolveGithubAsset: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../lib/ipc", () => ipcMocks);

import { pendingManualComments, ticketPrs } from "../../lib/stores";
import { selfReviewStateByTask } from "../../lib/taskScopedSelfReviewState";
import { clearTaskReviewPaneState } from "../../lib/taskReviewPaneState";

export const baseTask: Task = {
	id: "task-1",
	initial_prompt: "Test Task",
	status: "doing",
	project_id: "proj-1",
	prompt: null,
	title: null,
	title_source: null,
	title_generated_at: null,
	agent: null,
	permission_mode: null,
	worktree_source: null,
	worktree_branch: null,
	source_ticket_url: null,
	depends_on: [],
	created_at: Date.now(),
	updated_at: Date.now(),
};

export const baseDiff: PrFileDiff = {
	sha: "abc123",
	filename: "src/main.rs",
	status: "modified",
	additions: 5,
	deletions: 2,
	changes: 7,
	patch: "@@ -1,3 +1,4 @@\n line1\n+added\n line2",
	previous_filename: null,
	is_truncated: false,
	patch_line_count: null,
};

export function renderSelfReviewView(
	overrides: Partial<ComponentProps<typeof SelfReviewView>> = {},
) {
	return render(SelfReviewView, {
		props: {
			task: baseTask,
			agentStatus: null,
			onSendToAgent: vi.fn(),
			...overrides,
		},
	});
}

export class InlineDiffWorker {
	onmessage: ((ev: MessageEvent<DiffWorkerResponse>) => void) | null = null;
	onerror: ((ev: ErrorEvent) => void) | null = null;

	postMessage(message: DiffWorkerRequest): void {
		queueMicrotask(() => {
			try {
				if (message.type !== "process") return;

				const file = new DiffFile(
					message.data.oldFile.fileName,
					message.data.oldFile.content ?? "",
					message.data.newFile.fileName,
					message.data.newFile.content ?? "",
					message.data.hunks,
					message.data.oldFile.fileLang,
					message.data.newFile.fileLang,
				);

				file.initTheme(message.theme);
				file.initRaw();
				file.initSyntax({ registerHighlighter: highlighter });
				file.buildSplitDiffLines();
				file.buildUnifiedDiffLines();

				this.onmessage?.({
					data: { type: "result", id: message.id, bundle: file._getFullBundle() },
				} as MessageEvent<DiffWorkerResponse>);
				file.clearId();
			} catch (error) {
				this.onmessage?.({
					data: { type: "error", id: message.id, error: String(error) },
				} as MessageEvent<DiffWorkerResponse>);
			}
		});
	}

	terminate(): void {}
	addEventListener(): void {}
	removeEventListener(): void {}
	dispatchEvent(): boolean { return false; }
}

const defaultWorker = globalThis.Worker;

export function setupSelfReviewViewTestSuite(): void {
	beforeAll(() => {
		configureDiffHighlighter(highlighter);
	});

	beforeEach(() => {
		clearTaskReviewPaneState();
		selfReviewStateByTask.set(new Map());
		pendingManualComments.set([]);
		ticketPrs.set(new Map());
		vi.clearAllMocks();
	});

	afterEach(() => {
		globalThis.Worker = defaultWorker;
	});
}
