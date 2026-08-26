import { describe, expect, it, vi } from "vitest";
import { getPtyBuffer, resizePty } from "./ipc";
import {
	acquire,
	attach,
	markShellPtyStarted,
	recoverActiveTerminal,
	restorePtyInstance,
	subscribeShellLifecycle,
	updateShellLifecycleState,
} from "./terminalPool";
import {
	getFitAddonMocks,
	getListenCallback,
	getTerminalMock,
	getTerminalMocks,
} from "./terminalPool.testSetup";

describe("terminalPool reconnect", () => {

	it("pty-output listener writes to terminal", async () => {
		const entry = await acquire("task-10");
		await markShellPtyStarted(entry, 42);
		const { write: writeSpy } = getTerminalMocks(entry);

		const outputCb = getListenCallback("pty-output-task-10");
		outputCb({ payload: { data: "hello world", instance_id: 42 } });

		expect(writeSpy).toHaveBeenCalledWith("hello world", expect.any(Function));
		expect(entry.ptyActive).toBe(true);
	});

	it("pty-output listener ignores stale instance ids", async () => {
		const entry = await acquire("task-10-stale-output");
		const { write: writeSpy } = getTerminalMocks(entry);
		await markShellPtyStarted(entry, 2);

		const outputCb = getListenCallback("pty-output-task-10-stale-output");
		outputCb({ payload: { data: "old output", instance_id: 1 } });

		expect(writeSpy).not.toHaveBeenCalled();
		expect(entry.ptyActive).toBe(true);
	});

	it("accepts only current instance output after PTY instance metadata is hydrated", async () => {
		const entry = await acquire("task-10-hydrated-output");
		const { write: writeSpy, reset: resetSpy } = getTerminalMocks(entry);

		updateShellLifecycleState("task-10-hydrated-output", {
			ptyActive: true,
			shellExited: false,
			currentPtyInstance: 42,
			hasOutput: false,
		});

		const outputCb = getListenCallback("pty-output-task-10-hydrated-output");
		outputCb({ payload: { data: "old output", instance_id: 41 } });
		outputCb({ payload: { data: "current output", instance_id: 42 } });

		expect(writeSpy).toHaveBeenCalledTimes(1);
		expect(writeSpy).toHaveBeenCalledWith("current output", expect.any(Function));
		expect(resetSpy).not.toHaveBeenCalled();
		expect(entry.ptyActive).toBe(true);
		expect(entry.needsClear).toBe(false);
		expect(entry.currentPtyInstance).toBe(42);
	});

	it("pty-exit listener marks ptyActive false and needsClear true", async () => {
		const entry = await acquire("task-11");
		entry.ptyActive = true;

		const exitCb = getListenCallback("pty-exit-task-11");
		exitCb({ payload: {} });

		expect(entry.ptyActive).toBe(false);
		expect(entry.needsClear).toBe(true);
	});

	it("pty-exit listener ignores stale instance ids", async () => {
		const entry = await acquire("task-11-stale-exit");
		entry.ptyActive = true;
		await markShellPtyStarted(entry, 2);

		const exitCb = getListenCallback("pty-exit-task-11-stale-exit");
		exitCb({ payload: { instance_id: 1 } });

		expect(entry.ptyActive).toBe(true);
		expect(entry.needsClear).toBe(false);
	});

	it("notifies shell lifecycle subscribers only for accepted pty-exit events", async () => {
		const entry = await acquire("task-11-lifecycle-subscribe");
		const listener = vi.fn();
		entry.ptyActive = true;
		await markShellPtyStarted(entry, 2);

		const unsubscribe = subscribeShellLifecycle("task-11-lifecycle-subscribe", listener);
		const exitCb = getListenCallback("pty-exit-task-11-lifecycle-subscribe");

		exitCb({ payload: { instance_id: 1 } });
		expect(listener).not.toHaveBeenCalled();

		exitCb({ payload: { instance_id: 2 } });

		expect(listener).toHaveBeenCalledWith({
			ptyActive: false,
			shellExited: true,
			currentPtyInstance: 2,
			hasOutput: false,
		});

		unsubscribe();
	});

	it("needsClear causes terminal.reset on next pty-output", async () => {
		const entry = await acquire("task-12");
		await markShellPtyStarted(entry, 42);
		entry.needsClear = true;
		const { reset: resetSpy, write: writeSpy } = getTerminalMocks(entry);

		const outputCb = getListenCallback("pty-output-task-12");
		outputCb({ payload: { data: "new session output", instance_id: 42 } });

		expect(resetSpy).toHaveBeenCalled();
		expect(writeSpy).toHaveBeenCalledWith("new session output", expect.any(Function));
		expect(entry.needsClear).toBe(false);
	});

	it("replays backend buffers for active terminals after the app event stream reconnects", async () => {
		vi.mocked(getPtyBuffer).mockImplementation(async (taskId: string) => {
			if (taskId === "task-reconnect-a") return { buffer: "latest buffer a", isLive: true, instanceId: 42 };
			if (taskId === "task-reconnect-b") return { buffer: "latest buffer b", isLive: true, instanceId: 42 };
			return { buffer: null, isLive: false, instanceId: null };
		});
		const entryA = await acquire("task-reconnect-a");
		const entryB = await acquire("task-reconnect-b");
		const { reset: resetA, write: writeA } = getTerminalMocks(entryA);
		const { reset: resetB, write: writeB } = getTerminalMocks(entryB);
		resetA.mockClear();
		writeA.mockClear();
		resetB.mockClear();
		writeB.mockClear();

		const reconnectCb = getListenCallback("openforge-app-events-reconnected");
		reconnectCb({ payload: { attempt: 1 } });
		await vi.waitFor(() => expect(writeA).toHaveBeenCalledWith("latest buffer a", expect.any(Function)));

		expect(resetA).toHaveBeenCalled();
		expect(resetB).toHaveBeenCalled();
		expect(writeB).toHaveBeenCalledWith("latest buffer b", expect.any(Function));
		expect(entryA.ptyActive).toBe(true);
		expect(entryA.needsClear).toBe(false);
		expect(entryB.ptyActive).toBe(true);
		expect(entryB.needsClear).toBe(false);
	});

	it("recovers an attached resumed terminal by refitting, resizing its PTY, refreshing, and focusing", async () => {
		const entry = await acquire("task-reactivate");
		const wrapper = document.createElement("div");
		await attach(entry, wrapper);

		const { fit: fitSpy } = getFitAddonMocks(entry);
		const { refresh: refreshSpy, focus: focusSpy } = getTerminalMocks(entry);
		fitSpy.mockClear();
		refreshSpy.mockClear();
		focusSpy.mockClear();
		vi.mocked(resizePty).mockClear();

		await restorePtyInstance("task-reactivate", 42);
		await vi.waitFor(() => expect(fitSpy).toHaveBeenCalledTimes(1));

		expect(fitSpy).toHaveBeenCalledTimes(1);
		expect(resizePty).toHaveBeenCalledWith("task-reactivate", getTerminalMock(entry).cols, getTerminalMock(entry).rows);
		expect(refreshSpy).toHaveBeenCalled();
		expect(focusSpy).toHaveBeenCalled();
	});

	it("cancels resumed terminal recovery before touching an inactive terminal", async () => {
		const entry = await acquire("task-cancelled-reactivate");
		const wrapper = document.createElement("div");
		await attach(entry, wrapper);

		const { fit: fitSpy } = getFitAddonMocks(entry);
		const { refresh: refreshSpy, focus: focusSpy } = getTerminalMocks(entry);
		fitSpy.mockClear();
		refreshSpy.mockClear();
		focusSpy.mockClear();
		vi.mocked(resizePty).mockClear();
		const recoveryController = new AbortController();
		recoveryController.abort();

		await recoverActiveTerminal(entry, recoveryController.signal);

		expect(fitSpy).not.toHaveBeenCalled();
		expect(resizePty).not.toHaveBeenCalled();
		expect(refreshSpy).not.toHaveBeenCalled();
		expect(focusSpy).not.toHaveBeenCalled();
	});
});
