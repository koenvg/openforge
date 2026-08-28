import { describe, expect, it, vi } from "vitest";
import { getPtyBuffer, resizePty } from "./ipc";
import {
	acquire,
	attach,
	markShellPtyStarted,
	recoverActiveTerminal,
	restorePtyInstance,
	subscribeShellLifecycle,
} from "./terminalPool";
import {
	getFitAddonMocks,
	getListenCallback,
	getTerminalMock,
	getTerminalMocks,
} from "./terminalPool.testSetup";

function ghosttyReplay(data: string, instanceId: number) {
	return {
		buffer: null,
		isLive: true,
		instanceId,
		snapshot: { instanceId, watermark: 0, data: btoa(data) },
	};
}

function emitModelOutput(shellSessionKey: string, data: string, instanceId: number, sequence = 1): void {
	const callback = getListenCallback(`pty-model-output-${shellSessionKey}`);
	callback({ payload: { data: btoa(data), instance_id: instanceId, sequence } });
}
describe("terminalPool reconnect", () => {

	it("model-output listener writes to terminal", async () => {
		const entry = await acquire("task-10");
		vi.mocked(getPtyBuffer).mockResolvedValueOnce(ghosttyReplay("", 42));
		await markShellPtyStarted(entry, 42);
		const { write: writeSpy } = getTerminalMocks(entry);

		emitModelOutput("task-10", "hello world", 42);

		expect(writeSpy).toHaveBeenCalledWith(Uint8Array.from(new TextEncoder().encode("hello world")));
		expect(entry.ptyActive).toBe(true);
	});

	it("model-output listener ignores stale instance ids", async () => {
		const entry = await acquire("task-10-stale-output");
		const { write: writeSpy } = getTerminalMocks(entry);
		vi.mocked(getPtyBuffer).mockResolvedValueOnce(ghosttyReplay("", 2));
		await markShellPtyStarted(entry, 2);

		emitModelOutput("task-10-stale-output", "old output", 1);

		expect(writeSpy).not.toHaveBeenCalled();
		expect(entry.ptyActive).toBe(true);
	});


	it("pty-exit listener records shell exit and presentation reset independently", async () => {
		const entry = await acquire("task-11");
		entry.ptyActive = true;

		const exitCb = getListenCallback("pty-exit-task-11");
		exitCb({ payload: {} });

		expect(entry.ptyActive).toBe(false);
		expect(entry.needsClear).toBe(true);
		expect(entry.shellExited).toBe(true);
	});

	it("pty-exit listener ignores stale instance ids", async () => {
		const entry = await acquire("task-11-stale-exit");
		entry.ptyActive = true;
		await markShellPtyStarted(entry, 2);

		const exitCb = getListenCallback("pty-exit-task-11-stale-exit");
		exitCb({ payload: { instance_id: 1 } });

		expect(entry.ptyActive).toBe(true);
		expect(entry.needsClear).toBe(false);
		expect(entry.shellExited).toBe(false);
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


	it("restores backend snapshots for active terminals after the app event stream reconnects", async () => {
		vi.mocked(getPtyBuffer).mockImplementation(async (taskId: string) => {
			if (taskId === "task-reconnect-a") return ghosttyReplay("latest buffer a", 42);
			if (taskId === "task-reconnect-b") return ghosttyReplay("latest buffer b", 42);
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
		await vi.waitFor(() => expect(writeA).toHaveBeenCalledWith(
			Uint8Array.from(new TextEncoder().encode("latest buffer a")),
		));

		expect(resetA).toHaveBeenCalled();
		expect(resetB).toHaveBeenCalled();
		expect(writeB).toHaveBeenCalledWith(
			Uint8Array.from(new TextEncoder().encode("latest buffer b")),
		);
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
