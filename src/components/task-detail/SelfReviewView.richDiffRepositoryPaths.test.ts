import {
	baseDiff,
	baseTask,
	InlineDiffWorker,
	navigateMock,
	renderSelfReviewView,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrFileDiff } from "../../lib/types";
import {
	getTaskBatchFileContents,
	getTaskDiff,
	getTaskFileContents,
} from "../../lib/ipc";
import { revealFileInFileViewer } from "../../lib/fileViewerPlugin";
import { FILE_VIEWER_VIEW_KEY } from "../../lib/fileViewerView";

setupSelfReviewViewTestSuite();

describe('SelfReviewView Rich Diff repository paths', () => {
	beforeEach(() => {
		globalThis.Worker = InlineDiffWorker as unknown as typeof Worker;
	});
  it('loads nested worktree images and reveals relative links in the file viewer', async () => {
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/guides/README.md', sha: 'docs-sha' };
    vi.mocked(getTaskDiff).mockResolvedValue([markdownFile]);
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([[
      '',
      '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md)',
    ]]);
    vi.mocked(getTaskFileContents).mockResolvedValue(['', 'base64-diagram']);

    renderSelfReviewView();

    await fireEvent.click(await screen.findByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }));

    await waitFor(() => {
      expect(getTaskFileContents).toHaveBeenCalledWith(
        baseTask.id,
        'docs/assets/diagram.png',
        null,
        'modified',
        true,
        true,
      );
      expect(screen.getByAltText('Diagram').getAttribute('src'))
        .toBe('data:image/png;base64,base64-diagram');
    });

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }));
    expect(revealFileInFileViewer).toHaveBeenCalledWith('docs/SETUP.md');
    expect(navigateMock).toHaveBeenCalledWith(FILE_VIEWER_VIEW_KEY);
  });
});
