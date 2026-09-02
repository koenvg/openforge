import {
	baseDiff,
	baseTask,
	InlineDiffWorker,
	renderSelfReviewView,
	revealFileInTaskFiles,
	setupSelfReviewViewTestSuite,
} from "./SelfReviewView.testUtils";
import { fireEvent, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrFileDiff } from "../../lib/types";
import {
  getCommitBatchFileContents,
  getCommitDiff,
  getCommitFileContents,
	getTaskBatchFileContents,
	getTaskDiff,
	getTaskFileContents,
  getTaskCommits,
} from "../../lib/ipc";

setupSelfReviewViewTestSuite();

describe('SelfReviewView Rich Diff repository paths', () => {
	beforeEach(() => {
		globalThis.Worker = InlineDiffWorker as unknown as typeof Worker;
	});

  it('keeps changed repository link targets in the Review diff', async () => {
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/guides/README.md', sha: 'docs-sha' };
    const changedTarget: PrFileDiff = { ...baseDiff, filename: 'docs/SETUP.md', sha: 'setup-sha' };
    vi.mocked(getTaskDiff).mockResolvedValue([markdownFile, changedTarget]);
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([
      { oldContent: '', newContent: '[Setup](../SETUP.md?plain=1#installation)' },
      { oldContent: '', newContent: '# Installation\n\nChanged setup content' },
    ]);

    renderSelfReviewView();

    await fireEvent.click(await screen.findByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }));
    await fireEvent.click(await screen.findByRole('link', { name: 'Setup' }));

    expect(screen.queryByRole('region', { name: 'docs/SETUP.md repository preview' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open docs/SETUP.md in Files' })).toBeNull();
    expect(screen.getAllByTitle('docs/SETUP.md').length).toBeGreaterThan(0);
    expect(revealFileInTaskFiles).not.toHaveBeenCalled();
  });

  it('opens and closes revision-bound repository previews without replacing Review state', async () => {
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/guides/README.md', sha: 'docs-sha' };
    vi.mocked(getTaskDiff).mockResolvedValue([markdownFile]);
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([{
      oldContent: '',
      newContent: '![Diagram](../assets/diagram.png)\n\n[Setup](../SETUP.md?plain=1#installation)',
    }]);
    vi.mocked(getTaskFileContents)
      .mockResolvedValueOnce({ oldContent: '', newContent: 'base64-diagram' })
      .mockResolvedValueOnce({
        oldContent: '',
        newContent: '# Installation\n\nScoped setup content',
        newAvailability: { status: 'available', size: 35 },
      });

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

    const diffScrollArea = screen.getByRole('region', { name: 'Diff scroll area' });
    const changedFilesTree = screen.getByRole('tree', { name: 'Changed files' });
    const committedScope = screen.getByLabelText('Include committed changes');
    const feedbackPanel = screen.getByRole('region', { name: 'Feedback panel' });
    Object.defineProperty(diffScrollArea, 'scrollTop', { value: 196, writable: true, configurable: true });

    await fireEvent.click(screen.getByRole('link', { name: 'Setup' }));

    expect(await screen.findByRole('region', { name: 'docs/SETUP.md repository preview' })).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Installation' })).toBeTruthy();
    expect(getTaskFileContents).toHaveBeenLastCalledWith(
      baseTask.id,
      'docs/SETUP.md',
      null,
      'modified',
      true,
      true,
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Open docs/SETUP.md in Files' }));
    expect(revealFileInTaskFiles).toHaveBeenCalledWith(
      baseTask.id,
      'docs/SETUP.md',
      '?plain=1#installation',
    );
    expect(screen.getByRole('heading', { name: 'Installation' })).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Close repository preview' }));

    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'docs/SETUP.md repository preview' })).toBeNull();
    });
    expect(screen.getByRole('region', { name: 'Diff scroll area' })).toBe(diffScrollArea);
    expect(diffScrollArea.scrollTop).toBe(196);
    expect(screen.getByRole('tree', { name: 'Changed files' })).toBe(changedFilesTree);
    expect(screen.getByLabelText('Include committed changes')).toBe(committedScope);
    expect(screen.getByRole('region', { name: 'Feedback panel' })).toBe(feedbackPanel);
  });

  it('can open a missing Review link target in live Files for recovery', async () => {
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/README.md', sha: 'docs-sha' };
    vi.mocked(getTaskDiff).mockResolvedValue([markdownFile]);
    vi.mocked(getTaskBatchFileContents).mockResolvedValue([{
      oldContent: '',
      newContent: '[Missing guide](./MISSING.md?plain=1#expected-section)',
    }]);
    vi.mocked(getTaskFileContents).mockRejectedValue(new Error('Path does not exist in this revision'));

    renderSelfReviewView();

    await fireEvent.click(await screen.findByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }));
    await fireEvent.click(await screen.findByRole('link', { name: 'Missing guide' }));

    expect((await screen.findByRole('alert')).textContent).toContain('Path does not exist in this revision');
    await fireEvent.click(screen.getByRole('button', { name: 'Open docs/MISSING.md in Files' }));
    expect(revealFileInTaskFiles).toHaveBeenCalledWith(
      baseTask.id,
      'docs/MISSING.md',
      '?plain=1#expected-section',
    );
  });

  it('loads linked preview content from the selected commit instead of live task content', async () => {
    const commit = {
      sha: 'commit-sha',
      short_sha: 'commit-s',
      message: 'Historical review',
      author: 'dev',
      date: '2025-01-01T00:00:00Z',
    };
    const markdownFile: PrFileDiff = { ...baseDiff, filename: 'docs/README.md', sha: 'commit-file' };
    vi.mocked(getTaskDiff).mockResolvedValue([baseDiff]);
    vi.mocked(getTaskCommits).mockResolvedValue([commit]);
    vi.mocked(getCommitDiff).mockResolvedValue([markdownFile]);
    vi.mocked(getCommitBatchFileContents).mockResolvedValue([{
      oldContent: '',
      newContent: '[Guide](./GUIDE.md)',
    }]);
    vi.mocked(getCommitFileContents).mockResolvedValue({
      oldContent: '',
      newContent: '# Historical guide',
      newAvailability: { status: 'available', size: 18 },
    });

    renderSelfReviewView();

    await fireEvent.click(await screen.findByTitle(commit.message));
    await fireEvent.click(await screen.findByRole('button', { name: `Show rich diff for ${markdownFile.filename}` }));
    await fireEvent.click(await screen.findByRole('link', { name: 'Guide' }));

    expect(await screen.findByRole('heading', { name: 'Historical guide' })).toBeTruthy();
    expect(getCommitFileContents).toHaveBeenCalledWith(
      baseTask.id,
      commit.sha,
      'docs/GUIDE.md',
      null,
      'modified',
    );
    expect(getTaskFileContents).not.toHaveBeenCalledWith(
      baseTask.id,
      'docs/GUIDE.md',
      null,
      'modified',
      expect.any(Boolean),
      expect.any(Boolean),
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Open docs/GUIDE.md in Files' }));
    expect(revealFileInTaskFiles).toHaveBeenCalledWith(baseTask.id, 'docs/GUIDE.md', '');
    expect(screen.getByRole('heading', { name: 'Historical guide' })).toBeTruthy();
    expect(screen.getByText(/Previewing commit commit-s/)).toBeTruthy();

    await fireEvent.click(screen.getByRole('button', { name: 'Close repository preview' }));
    expect(screen.getByText('Show all changes')).toBeTruthy();
  });
});
