import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import type { PrFileDiff, ReviewSubmissionComment } from "./types";
import {
	clearPendingSelfReviewComments,
	getPendingSelfReviewComments,
	getSelfReviewDiffFiles,
	mergeVisiblePendingSelfReviewComments,
	pendingSelfReviewCommentsByTask,
	selfReviewStateByTask,
	setPendingSelfReviewComments,
	setSelfReviewDiffFiles,
} from "./taskScopedSelfReviewState";

const taskOneComment: ReviewSubmissionComment = {
	path: "src/task-one.ts",
	line: 12,
	side: "RIGHT",
	body: "task one feedback",
};

const taskTwoComment: ReviewSubmissionComment = {
	path: "src/task-two.ts",
	line: 34,
	side: "RIGHT",
	body: "task two feedback",
};

const taskOneDiff: PrFileDiff = {
	sha: "abc123",
	filename: "src/task-one.ts",
	status: "modified",
	additions: 1,
	deletions: 0,
	changes: 1,
	patch: "@@ -1 +1 @@\n+task one",
	previous_filename: null,
	is_truncated: false,
	patch_line_count: null,
};

const taskTwoDiff: PrFileDiff = {
	...taskOneDiff,
	sha: "def456",
	filename: "src/task-two.ts",
};

describe("task-scoped self-review state", () => {
	beforeEach(() => {
		selfReviewStateByTask.set(new Map());
	});

	it("keeps loaded diff files isolated by task id", () => {
		setSelfReviewDiffFiles("task-1", [taskOneDiff]);
		setSelfReviewDiffFiles("task-2", [taskTwoDiff]);

		expect(getSelfReviewDiffFiles("task-1")).toEqual([taskOneDiff]);
		expect(getSelfReviewDiffFiles("task-2")).toEqual([taskTwoDiff]);
	});

	it("updates maps immutably so scoped self-review changes are reactive", () => {
		const before = get(selfReviewStateByTask);

		setSelfReviewDiffFiles("task-1", [taskOneDiff]);

		const after = get(selfReviewStateByTask);
		expect(after).not.toBe(before);
		expect(after.get("task-1")?.diffFiles).toEqual([taskOneDiff]);
	});

	it("keeps pending inline review comments isolated by task id", () => {
		setPendingSelfReviewComments("task-1", [taskOneComment]);
		setPendingSelfReviewComments("task-2", [taskTwoComment]);

		expect(getPendingSelfReviewComments("task-1")).toEqual([taskOneComment]);
		expect(getPendingSelfReviewComments("task-2")).toEqual([taskTwoComment]);
		expect(get(pendingSelfReviewCommentsByTask)).toEqual(
			new Map([
				["task-1", [taskOneComment]],
				["task-2", [taskTwoComment]],
			]),
		);
	});

	it("preserves hidden pending inline comments when applying visible review updates", () => {
		const hiddenComment: ReviewSubmissionComment = {
			...taskOneComment,
			path: "src/hidden.ts",
			body: "hidden while comparing snapshot",
		};
		const visibleUpdate: ReviewSubmissionComment = {
			...taskTwoComment,
			body: "visible file update",
		};

		expect(
			mergeVisiblePendingSelfReviewComments(
				[hiddenComment, taskOneComment],
				[visibleUpdate],
				new Set(["src/hidden.ts"]),
			),
		).toEqual([hiddenComment, visibleUpdate]);
	});

	it("clears only the selected task pending inline comments", () => {
		setPendingSelfReviewComments("task-1", [taskOneComment]);
		setPendingSelfReviewComments("task-2", [taskTwoComment]);

		clearPendingSelfReviewComments("task-1");

		expect(getPendingSelfReviewComments("task-1")).toEqual([]);
		expect(getPendingSelfReviewComments("task-2")).toEqual([taskTwoComment]);
	});
});
