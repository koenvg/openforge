import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { pushNavState, navigateBack, resetToBoard } from './navigation';
import { currentView, selectedTaskId, activeProjectId, selectedReviewPr, selectedSkillName } from './stores';

describe('navigation - activeProjectId', () => {
  beforeEach(() => {
    currentView.set('board');
    selectedTaskId.set(null);
    selectedReviewPr.set(null);
    selectedSkillName.set(null);
    activeProjectId.set(null);
    // Clear history by navigating back until empty
    while (navigateBack()) { /* drain */ }
    // Reset stores after draining
    currentView.set('board');
    selectedTaskId.set(null);
    selectedReviewPr.set(null);
    selectedSkillName.set(null);
    activeProjectId.set(null);
  });

  it('pushNavState captures activeProjectId and navigateBack restores it', () => {
    activeProjectId.set('proj-1');
    pushNavState();

    // Change to different project
    activeProjectId.set('proj-2');
    currentView.set('settings');

    const result = navigateBack();
    expect(result).toBe(true);
    expect(get(activeProjectId)).toBe('proj-1');
    expect(get(currentView)).toBe('board');
  });

  it('navigateBack restores activeProjectId to a different value', () => {
    activeProjectId.set('proj-A');
    currentView.set('board');
    pushNavState();

    activeProjectId.set('proj-B');
    currentView.set('workqueue');
    pushNavState();

    activeProjectId.set('proj-C');

    navigateBack();
    expect(get(activeProjectId)).toBe('proj-B');

    navigateBack();
    expect(get(activeProjectId)).toBe('proj-A');
  });

  it('navigateBack restores null activeProjectId', () => {
    activeProjectId.set(null);
    pushNavState();

    activeProjectId.set('proj-2');

    navigateBack();
    expect(get(activeProjectId)).toBeNull();
  });
});

describe('resetToBoard', () => {
  beforeEach(() => {
    currentView.set('board');
    selectedTaskId.set(null);
    selectedReviewPr.set(null);
    selectedSkillName.set(null);
    activeProjectId.set(null);
    while (navigateBack()) { /* drain */ }
    currentView.set('board');
    selectedTaskId.set(null);
    selectedReviewPr.set(null);
    selectedSkillName.set(null);
    activeProjectId.set(null);
  });

  it('sets currentView to board and clears selectedTaskId', () => {
    currentView.set('settings');
    selectedTaskId.set('task-1');

    resetToBoard();

    expect(get(currentView)).toBe('board');
    expect(get(selectedTaskId)).toBeNull();
  });

  it('resets from pr_review view', () => {
    currentView.set('pr_review');

    resetToBoard();

    expect(get(currentView)).toBe('board');
  });

  it('resets from skills view', () => {
    currentView.set('skills');

    resetToBoard();

    expect(get(currentView)).toBe('board');
  });

  it('clears navigation history', () => {
    activeProjectId.set('proj-1');
    currentView.set('board');
    pushNavState();

    currentView.set('settings');
    pushNavState();

    resetToBoard();

    const result = navigateBack();
    expect(result).toBe(false);
  });

  it('does not change activeProjectId', () => {
    activeProjectId.set('proj-1');
    currentView.set('settings');
    selectedTaskId.set('task-1');

    resetToBoard();

    expect(get(activeProjectId)).toBe('proj-1');
  });

  it('is a no-op when already on board with no task selected', () => {
    currentView.set('board');
    selectedTaskId.set(null);

    resetToBoard();

    expect(get(currentView)).toBe('board');
    expect(get(selectedTaskId)).toBeNull();
  });
});
