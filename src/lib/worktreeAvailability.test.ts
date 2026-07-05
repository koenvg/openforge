import { describe, expect, it } from "vitest";
import { resolveWorktreeAvailability } from "./worktreeAvailability";

describe("resolveWorktreeAvailability", () => {
  it("disables and turns off the worktree when the repo has no commits, ignoring the project default", () => {
    expect(resolveWorktreeAvailability(false, true)).toEqual({
      worktreeAllowed: false,
      useWorktree: false,
    });
    expect(resolveWorktreeAvailability(false, false)).toEqual({
      worktreeAllowed: false,
      useWorktree: false,
    });
  });

  it("allows the worktree and honors a true project default when the repo has commits", () => {
    expect(resolveWorktreeAvailability(true, true)).toEqual({
      worktreeAllowed: true,
      useWorktree: true,
    });
  });

  it("allows the worktree but honors a false project default when the repo has commits", () => {
    expect(resolveWorktreeAvailability(true, false)).toEqual({
      worktreeAllowed: true,
      useWorktree: false,
    });
  });
});
