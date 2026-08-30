import { describe, expect, it, vi } from "vitest";
import { TERMINAL_FONT_FAMILY } from "./terminalOptions";
import { getPtyBuffer } from './ipc'
import {
	_getPool,
	acquire,
	attach,
	clearPtySpawnPending,
	clearTaskTerminalTabsSession,
	getShellLifecycleState,
	getTaskTerminalTabsSession,
	isPtyActive,
	isShellExited,
	isValidTerminalDimensions,
	markPtySpawnPending,
	markShellPtyStarted,
	release,
	releaseAll,
	releaseAllForTask,
	shouldSpawnPty,
	updateShellLifecycleState,
	updateTaskTerminalTabsSession,
} from "./terminalPool";
import {
	fontLoadMock,
	getListenCallback,
	getTerminalFontFamily,
	getTerminalMock,
	getTerminalMocks,
	listenCallbacks,
	unlistenFns,
} from "./terminalPool.testSetup";

describe("terminalPool lifecycle", () => {

	it("acquire creates a new pool entry", async () => {
		const entry = await acquire("task-1");
		expect(entry).toBeDefined();
		expect(entry.shellSessionKey).toBe("task-1");
		expect(getTerminalMock(entry)).toBeDefined();
		expect(entry.view).toBeDefined();
		expect(entry.view.geometry).toEqual({ cols: 80, rows: 24 });
		expect(entry.attached).toBe(false);
		expect(_getPool().has("task-1")).toBe(true);
	});

	it("initializes terminal with the correct font family stack including JetBrains Mono and Nerd Font fallback", async () => {
		const entry = await acquire("task-font-check");
		expect(getTerminalFontFamily(getTerminalMock(entry))).toBe(TERMINAL_FONT_FAMILY);
	});

	it("acquire preloads the bundled terminal web fonts before open", async () => {
		await acquire("task-font-preload");

		expect(fontLoadMock).toHaveBeenCalledWith('400 13px "JetBrains Mono"');
		expect(fontLoadMock).toHaveBeenCalledWith('700 13px "JetBrains Mono"');
		expect(fontLoadMock).toHaveBeenCalledWith('italic 400 13px "JetBrains Mono"');
		expect(fontLoadMock).toHaveBeenCalledWith('italic 700 13px "JetBrains Mono"');
		expect(fontLoadMock).toHaveBeenCalledWith(
			'400 13px "Symbols Nerd Font Mono"',
		);
	});

	it("acquire returns existing entry on second call", async () => {
		const entry1 = await acquire("task-2");
		const entry2 = await acquire("task-2");
		expect(entry1).toBe(entry2);
	});

	it("acquire sets up lifecycle listeners but defers model output until attachment", async () => {
		await acquire("task-3");
		expect(listenCallbacks.has("pty-model-output-task-3")).toBe(false);
		expect(listenCallbacks.has("pty-model-disabled-task-3")).toBe(true);
		expect(listenCallbacks.has("pty-exit-task-3")).toBe(true);
	});

	it("release disposes terminal and removes from pool", async () => {
		const entry = await acquire("task-8");
		const { dispose: disposeSpy } = getTerminalMocks(entry);

		release("task-8");

		expect(disposeSpy).toHaveBeenCalled();
		expect(_getPool().has("task-8")).toBe(false);
	});

	it("release calls unlisten functions", async () => {
		await acquire("task-9");
		const savedUnlistens = [...unlistenFns];

		release("task-9");

		for (const fn of savedUnlistens) {
			expect(fn).toHaveBeenCalled();
		}
	});

	it("release is safe for unknown taskId", () => {
		expect(() => release("nonexistent")).not.toThrow();
	});

	it("releaseAll clears all entries", async () => {
		await acquire("task-a");
		await acquire("task-b");
		expect(_getPool().size).toBe(2);

		releaseAll();
		expect(_getPool().size).toBe(0);
	});

	describe("terminal dimension validation", () => {
		it("accepts numeric terminal dimensions", () => {
			expect(isValidTerminalDimensions({ cols: 80, rows: 24 })).toBe(true);
		});

		it("rejects NaN terminal dimensions without coercion", () => {
			expect(isValidTerminalDimensions({ cols: Number.NaN, rows: 24 })).toBe(false);
			expect(isValidTerminalDimensions({ cols: 80, rows: Number.NaN })).toBe(false);
		});

		it("rejects string terminal dimensions that global isNaN would coerce", () => {
			expect(isValidTerminalDimensions({ cols: "80", rows: 24 })).toBe(false);
			expect(isValidTerminalDimensions({ cols: 80, rows: "24" })).toBe(false);
		});
	});

	describe("isPtyActive", () => {
		it("returns true when pool entry has ptyActive true", async () => {
			const entry = await acquire("task-pty-check");
			entry.ptyActive = true;
			expect(isPtyActive("task-pty-check")).toBe(true);
		});

		it("returns false when pool entry has ptyActive false", async () => {
			const entry = await acquire("task-pty-off");
			entry.ptyActive = false;
			expect(isPtyActive("task-pty-off")).toBe(false);
		});

		it("returns false for unknown task", () => {
			expect(isPtyActive("nonexistent")).toBe(false);
		});
	});

	describe("shell exited state", () => {
		it("reports the explicit shell exit state independently of presentation reset", async () => {
			const entry = await acquire("task-shell-exited");
			entry.ptyActive = false;
			entry.needsClear = false;
			entry.shellExited = true;

			expect(isShellExited("task-shell-exited")).toBe(true);
		});

		it("reports false when only a presentation reset is pending", async () => {
			const entry = await acquire("task-shell-active");
			entry.ptyActive = false;
			entry.needsClear = true;

			expect(isShellExited("task-shell-active")).toBe(false);
		});

		it("exposes pool-owned shell lifecycle state object", async () => {
			const entry = await acquire("task-shell-state");
			entry.ptyActive = false;
			entry.needsClear = false;
			entry.shellExited = true;

			const state = getShellLifecycleState("task-shell-state");

			expect(state.ptyActive).toBe(false);
			expect(state.shellExited).toBe(true);
			expect(state.currentPtyInstance).toBeNull();
			expect(state.hasOutput).toBe(false);
		});

		it("updates pool-owned shell lifecycle state through helper", async () => {
			await acquire("task-shell-update");

			updateShellLifecycleState("task-shell-update", {
				ptyActive: true,
				shellExited: false,
				currentPtyInstance: 42,
				hasOutput: false,
			});

			const state = getShellLifecycleState("task-shell-update");
			expect(state.ptyActive).toBe(true);
			expect(state.shellExited).toBe(false);
			expect(state.currentPtyInstance).toBe(42);
		});
	});

	describe("task terminal tab sessions", () => {
		it("creates a default task tab session in the pool", () => {
			const session = getTaskTerminalTabsSession("T-100");

			expect(session.activeTabIndex).toBe(0);
			expect(session.nextIndex).toBe(1);
			expect(session.tabs).toEqual([
				{ index: 0, key: "T-100-shell-0", label: "Shell 1" },
			]);
		});

		it("persists task tab session updates in the pool", () => {
			updateTaskTerminalTabsSession("T-101", {
				tabs: [
					{ index: 0, key: "T-101-shell-0", label: "Shell 1" },
					{ index: 1, key: "T-101-shell-1", label: "Shell 2" },
				],
				activeTabIndex: 1,
				nextIndex: 2,
			});

			const session = getTaskTerminalTabsSession("T-101");
			expect(session.tabs).toHaveLength(2);
			expect(session.activeTabIndex).toBe(1);
			expect(session.nextIndex).toBe(2);
		});

		it("clears only the requested task tab session", () => {
			getTaskTerminalTabsSession("T-102");
			getTaskTerminalTabsSession("T-103");

			clearTaskTerminalTabsSession("T-102");

			expect(getTaskTerminalTabsSession("T-102")).toEqual({
				tabs: [{ index: 0, key: "T-102-shell-0", label: "Shell 1" }],
				activeTabIndex: 0,
				nextIndex: 1,
			});
			expect(getTaskTerminalTabsSession("T-103").tabs).toHaveLength(1);
		});
	});

	describe("spawn state tracking", () => {
		it("shouldSpawnPty returns false while a spawn is pending for the entry", async () => {
			const entry = await acquire("task-spawn-pending");
			expect(shouldSpawnPty(entry)).toBe(true);

			markPtySpawnPending(entry);

			expect(shouldSpawnPty(entry)).toBe(false);
		});

		it("clearPtySpawnPending allows spawning again when PTY is still inactive", async () => {
			const entry = await acquire("task-spawn-clear");
			markPtySpawnPending(entry);

			clearPtySpawnPending(entry);

			expect(shouldSpawnPty(entry)).toBe(true);
		});

		it("shouldSpawnPty stays false when PTY is already active", async () => {
			const entry = await acquire("task-spawn-active");
			entry.ptyActive = true;

			expect(shouldSpawnPty(entry)).toBe(false);
		});
	});

	describe("shell-key independence", () => {
		it("agent key and shell key create separate pool entries", async () => {
			const agentEntry = await acquire("T-42");
			const shellEntry = await acquire("T-42-shell");

			expect(agentEntry).toBeDefined();
			expect(shellEntry).toBeDefined();
			expect(agentEntry).not.toBe(shellEntry);
			expect(agentEntry.shellSessionKey).toBe("T-42");
			expect(shellEntry.shellSessionKey).toBe("T-42-shell");
			expect(_getPool().has("T-42")).toBe(true);
			expect(_getPool().has("T-42-shell")).toBe(true);
			expect(_getPool().size).toBe(2);
		});

		it("releasing agent key does not affect shell key entry", async () => {
			await acquire("T-43");
			const shellEntry = await acquire("T-43-shell");

			release("T-43");

			expect(_getPool().has("T-43")).toBe(false);
			expect(_getPool().has("T-43-shell")).toBe(true);
			expect(_getPool().get("T-43-shell")).toBe(shellEntry);
		});

		it("both entries have independent ptyActive state", async () => {
			const agentEntry = await acquire("T-44");
			const shellEntry = await acquire("T-44-shell");
			vi.mocked(getPtyBuffer).mockImplementation(async (shellSessionKey) => {
				const instanceId = shellSessionKey === "T-44" ? 44 : 45;
				return {
					buffer: null,
					isLive: true,
					instanceId,
					snapshot: { instanceId, watermark: 0, data: btoa("") },
				};
			});
			await markShellPtyStarted(agentEntry, 44);
			await markShellPtyStarted(shellEntry, 45);
			await attach(agentEntry, document.createElement("div"));
			await attach(shellEntry, document.createElement("div"));
			shellEntry.ptyActive = false;

			const agentOutputCb = getListenCallback("pty-model-output-T-44");
			agentOutputCb({ payload: { data: btoa("agent output"), instance_id: 44, sequence: 1 } });

			expect(agentEntry.ptyActive).toBe(true);
			expect(shellEntry.ptyActive).toBe(false);

			const shellOutputCb = getListenCallback("pty-model-output-T-44-shell");
			shellOutputCb({ payload: { data: btoa("shell output"), instance_id: 45, sequence: 1 } });

			expect(agentEntry.ptyActive).toBe(true);
			expect(shellEntry.ptyActive).toBe(true);

			const agentExitCb = getListenCallback("pty-exit-T-44");
			agentExitCb({ payload: { instance_id: 44 } });

			expect(agentEntry.ptyActive).toBe(false);
			expect(shellEntry.ptyActive).toBe(true);
		});
	});

	describe("releaseAllForTask", () => {
		it("releases all shell entries matching {taskId}-shell-* pattern", async () => {
			// Create agent terminal and multiple shell terminals
			await acquire("task-1");
			await acquire("task-1-shell-0");
			await acquire("task-1-shell-1");
			await acquire("task-1-shell-2");

			expect(_getPool().size).toBe(4);

			// Release all shells for task-1
			const count = releaseAllForTask("task-1");

			// Should have released 3 shell entries
			expect(count).toBe(3);
			// Agent terminal should still exist
			expect(_getPool().has("task-1")).toBe(true);
			// All shell entries should be gone
			expect(_getPool().has("task-1-shell-0")).toBe(false);
			expect(_getPool().has("task-1-shell-1")).toBe(false);
			expect(_getPool().has("task-1-shell-2")).toBe(false);
			expect(_getPool().size).toBe(1);
		});

		it("does not release agent terminal or other tasks shells", async () => {
			// Create entries for task-1 and task-2
			await acquire("task-1");
			await acquire("task-1-shell-0");
			await acquire("task-1-shell-1");
			await acquire("task-2");
			await acquire("task-2-shell-0");

			expect(_getPool().size).toBe(5);

			// Release all shells for task-1
			const count = releaseAllForTask("task-1");

			// Should have released only 2 task-1 shells
			expect(count).toBe(2);
			// task-1 agent should still exist
			expect(_getPool().has("task-1")).toBe(true);
			// task-2 and its shell should still exist
			expect(_getPool().has("task-2")).toBe(true);
			expect(_getPool().has("task-2-shell-0")).toBe(true);
			expect(_getPool().size).toBe(3);
		});

		it("returns 0 when task has no shell entries", async () => {
			// Create only agent terminal
			await acquire("task-3");

			expect(_getPool().size).toBe(1);

			// Release all shells for task-3 (none exist)
			const count = releaseAllForTask("task-3");

			// Should return 0
			expect(count).toBe(0);
			// Agent terminal should still exist
			expect(_getPool().has("task-3")).toBe(true);
			expect(_getPool().size).toBe(1);
		});

		it("returns 0 when task does not exist", () => {
			expect(_getPool().size).toBe(0);

			// Release all shells for non-existent task
			const count = releaseAllForTask("nonexistent-task");

			// Should return 0
			expect(count).toBe(0);
			expect(_getPool().size).toBe(0);
		});

		it("calls unlisten functions for released entries", async () => {
			await acquire("task-4");
			await acquire("task-4-shell-0");
			const savedUnlistens = [...unlistenFns];

			releaseAllForTask("task-4");

			// At least one unlisten should have been called (for the shell entry)
			expect(savedUnlistens.some((fn) => fn.mock.calls.length > 0)).toBe(true);
		});

		it("disposes terminals for released entries", async () => {
			const shell0Entry = await acquire("task-5-shell-0");
			const shell1Entry = await acquire("task-5-shell-1");
			const { dispose: shell0Spy } = getTerminalMocks(shell0Entry);
			const { dispose: shell1Spy } = getTerminalMocks(shell1Entry);

			releaseAllForTask("task-5");

			expect(shell0Spy).toHaveBeenCalled();
			expect(shell1Spy).toHaveBeenCalled();
		});
	});
});
