import type { FileContents } from '@openforge-app/pr-review-ui/diffAdapter';
import type { PrFileDiff } from './types';
import type { ReviewedFileSnapshot } from './taskReviewPaneState';

export interface ReviewedBaselineComparisonResult {
	files: PrFileDiff[];
	contents: Map<string, FileContents>;
}

export interface ReviewedBaselineComparisonDeps {
	files: PrFileDiff[];
	snapshots: Map<string, ReviewedFileSnapshot>;
	getFileIdentity: (file: PrFileDiff) => string | null;
	fetchCurrentContents: (files: PrFileDiff[]) => Promise<Map<string, FileContents>>;
}

type DiffOperation =
	| { kind: 'context'; line: string }
	| { kind: 'remove'; line: string }
	| { kind: 'add'; line: string };

function splitContentLines(content: string): string[] {
	if (content.length === 0) return [];
	const lines = content.split('\n');
	if (lines.at(-1) === '') lines.pop();
	return lines;
}

const maxLcsCells = 250_000;

function buildWholeFileReplacementOperations(oldLines: string[], newLines: string[]): DiffOperation[] {
	return [
		...oldLines.map((line): DiffOperation => ({ kind: 'remove', line })),
		...newLines.map((line): DiffOperation => ({ kind: 'add', line })),
	];
}

function buildLineOperations(oldLines: string[], newLines: string[]): DiffOperation[] {
	const rows = oldLines.length + 1;
	const cols = newLines.length + 1;
	if (rows * cols > maxLcsCells) {
		return buildWholeFileReplacementOperations(oldLines, newLines);
	}
	const lengths = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

	for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
		for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
			lengths[oldIndex]![newIndex] = oldLines[oldIndex] === newLines[newIndex]
				? lengths[oldIndex + 1]![newIndex + 1]! + 1
				: Math.max(lengths[oldIndex + 1]![newIndex]!, lengths[oldIndex]![newIndex + 1]!);
		}
	}

	const operations: DiffOperation[] = [];
	let oldIndex = 0;
	let newIndex = 0;
	while (oldIndex < oldLines.length || newIndex < newLines.length) {
		if (oldIndex < oldLines.length && newIndex < newLines.length && oldLines[oldIndex] === newLines[newIndex]) {
			operations.push({ kind: 'context', line: oldLines[oldIndex]! });
			oldIndex += 1;
			newIndex += 1;
		} else if (newIndex < newLines.length && (oldIndex >= oldLines.length || lengths[oldIndex]![newIndex + 1]! >= lengths[oldIndex + 1]![newIndex]!)) {
			operations.push({ kind: 'add', line: newLines[newIndex]! });
			newIndex += 1;
		} else if (oldIndex < oldLines.length) {
			operations.push({ kind: 'remove', line: oldLines[oldIndex]! });
			oldIndex += 1;
		}
	}
	return operations;
}

function createUnifiedPatch(oldContent: string, newContent: string): string | null {
	if (oldContent === newContent) return null;
	const oldLines = splitContentLines(oldContent);
	const newLines = splitContentLines(newContent);
	const operations = buildLineOperations(oldLines, newLines);
	const body = operations.map((operation) => {
		switch (operation.kind) {
			case 'add':
				return `+${operation.line}`;
			case 'remove':
				return `-${operation.line}`;
			case 'context':
				return ` ${operation.line}`;
		}
	}).join('\n');
	const oldRange = oldLines.length === 0 ? '0,0' : `1,${oldLines.length}`;
	const newRange = newLines.length === 0 ? '0,0' : `1,${newLines.length}`;
	return `@@ -${oldRange} +${newRange} @@${body.length > 0 ? `\n${body}` : ''}`;
}

function countChanges(patch: string | null): { additions: number; deletions: number } {
	if (patch === null) return { additions: 0, deletions: 0 };
	let additions = 0;
	let deletions = 0;
	for (const line of patch.split('\n')) {
		if (line.startsWith('+')) additions += 1;
		if (line.startsWith('-')) deletions += 1;
	}
	return { additions, deletions };
}

function statusForReviewedBaseline(oldContent: string, newContent: string): string {
	if (oldContent.length === 0 && newContent.length > 0) return 'added';
	if (oldContent.length > 0 && newContent.length === 0) return 'removed';
	return 'modified';
}

export async function buildReviewedBaselineComparison({
	files,
	snapshots,
	getFileIdentity,
	fetchCurrentContents,
}: ReviewedBaselineComparisonDeps): Promise<ReviewedBaselineComparisonResult> {
	const changedFiles = files.filter((file) => {
		const snapshot = snapshots.get(file.filename);
		const currentIdentity = getFileIdentity(file);
		return snapshot !== undefined && currentIdentity !== null && snapshot.identity !== currentIdentity;
	});
	if (changedFiles.length === 0) {
		return { files: [], contents: new Map() };
	}

	const currentContents = await fetchCurrentContents(changedFiles);
	const comparisonFiles: PrFileDiff[] = [];
	const comparisonContents = new Map<string, FileContents>();
	for (const file of changedFiles) {
		const snapshot = snapshots.get(file.filename);
		const current = currentContents.get(file.filename);
		if (snapshot === undefined || current === undefined) continue;

		const oldContent = snapshot.newContent;
		const newContent = current.newContent;
		const patch = createUnifiedPatch(oldContent, newContent);
		if (patch === null) continue;

		const { additions, deletions } = countChanges(patch);
		comparisonFiles.push({
			...file,
			status: statusForReviewedBaseline(oldContent, newContent),
			additions,
			deletions,
			changes: additions + deletions,
			patch,
			previous_filename: null,
			is_truncated: false,
			patch_line_count: null,
		});
		comparisonContents.set(file.filename, { oldContent, newContent });
	}

	return { files: comparisonFiles, contents: comparisonContents };
}
