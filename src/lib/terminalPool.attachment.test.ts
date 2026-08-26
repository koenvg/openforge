import { describe, expect, it, vi } from "vitest";
import {
	acquire,
	attach,
	detach,
	focusTerminal,
	markShellPtyStarted,
	recoverActiveTerminal,
} from "./terminalPool";
import {
	getEntryIndex,
	getFitAddonMocks,
	getListenCallback,
	getLoadedAddonNames,
	getTerminalMocks,
	requireValue,
	setWebglConstructorFailure,
	setWebglContextLossOnLoad,
	setWebglLoadFailure,
	webglAddonInstances,
	webglContextLossDisposables,
	webglContextLossListeners,
} from "./terminalPool.testSetup";

describe("terminalPool attachment", () => {

	it("attach appends hostDiv to wrapper and marks attached", async () => {
		const entry = await acquire("task-4");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);

		expect(wrapper.childElementCount).toBe(1);
		expect(entry.attached).toBe(true);
	});

	it("defers WebGL renderer loading until the terminal opens on an attached host", async () => {
		const entry = await acquire("task-webgl-deferred");
		const { loadAddon: loadAddonSpy, open: openSpy } = getTerminalMocks(entry);

		expect(openSpy).not.toHaveBeenCalled();
		expect(getLoadedAddonNames(entry).slice(0, 2)).toEqual(["FitAddon", "WebLinksAddon"]);

		const wrapper = document.createElement("div");
		await attach(entry, wrapper);

		expect(openSpy).toHaveBeenCalledWith(wrapper.firstElementChild);
		expect(getLoadedAddonNames(entry)).toContain("WebglAddon");
		expect(openSpy.mock.invocationCallOrder[0]).toBeLessThan(
			loadAddonSpy.mock.invocationCallOrder[4],
		);
	});

	it("loads the WebGL renderer addon for both agent and shell terminal keys", async () => {
		const agentEntry = await acquire("T-50");
		const shellEntry = await acquire("T-50-shell-0");
		const agentWrapper = document.createElement("div");
		const shellWrapper = document.createElement("div");

		await attach(agentEntry, agentWrapper);
		await attach(shellEntry, shellWrapper);

		const { open: agentOpenSpy, loadAddon: agentLoadAddonSpy } =
			getTerminalMocks(agentEntry);
		const { open: shellOpenSpy, loadAddon: shellLoadAddonSpy } =
			getTerminalMocks(shellEntry);

		expect(agentOpenSpy).toHaveBeenCalledWith(agentWrapper.firstElementChild);
		expect(shellOpenSpy).toHaveBeenCalledWith(shellWrapper.firstElementChild);
		expect(agentLoadAddonSpy).toHaveBeenCalledTimes(5);
		expect(shellLoadAddonSpy).toHaveBeenCalledTimes(5);
		expect(getLoadedAddonNames(agentEntry)).toContain("WebglAddon");
		expect(getLoadedAddonNames(shellEntry)).toContain("WebglAddon");
	});

	it("attach falls back to the default renderer when WebglAddon construction fails", async () => {
		setWebglConstructorFailure(true);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		try {
			const entry = await acquire("task-webgl-constructor-fallback");
			const wrapper = document.createElement("div");

			await attach(entry, wrapper);

			expect(entry).toBeDefined();
			expect(getLoadedAddonNames(entry)).not.toContain("WebglAddon");
			expect(warnSpy).toHaveBeenCalledWith(
				"[terminalSessionService] WebGL renderer unavailable; falling back to the default renderer:",
				expect.any(Error),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("attach falls back to the default renderer when WebglAddon load fails", async () => {
		setWebglLoadFailure(true);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		try {
			const entry = await acquire("task-webgl-load-fallback");
			const wrapper = document.createElement("div");

			await attach(entry, wrapper);

			expect(entry).toBeDefined();
			expect(getLoadedAddonNames(entry)).toContain("WebglAddon");
			expect(warnSpy).toHaveBeenCalledWith(
				"[terminalSessionService] WebGL renderer unavailable; falling back to the default renderer:",
				expect.any(Error),
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("recovers when the WebGL context is lost during addon activation", async () => {
		setWebglContextLossOnLoad(true);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		try {
			const entry = await acquire("task-webgl-context-loss-during-load");
			const wrapper = document.createElement("div");

			await attach(entry, wrapper);

			expect(webglContextLossDisposables[0]).toHaveBeenCalled();
			expect(webglAddonInstances[0]?.dispose).toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(
				"[terminalSessionService] WebGL renderer context lost; falling back to the default renderer.",
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("recovers from WebGL context loss by disposing the accelerated renderer and keeping terminal output alive", async () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		try {
			const entry = await acquire("task-webgl-context-loss");
			const wrapper = document.createElement("div");

			await attach(entry, wrapper);

			const webglAddon = requireValue(webglAddonInstances[getEntryIndex(entry)], "Expected WebGL addon to be loaded");
			const { loadAddon: loadAddonSpy, refresh: refreshSpy, reset: resetSpy } = getTerminalMocks(entry);
			entry.ptyActive = true;
			entry.currentPtyInstance = 42;
			loadAddonSpy.mockClear();

			webglContextLossListeners[0]?.();

			expect(webglContextLossDisposables[0]).toHaveBeenCalled();
			expect(webglAddon.dispose).toHaveBeenCalled();
			expect(entry.ptyActive).toBe(true);
			expect(entry.currentPtyInstance).toBe(42);
			expect(resetSpy).not.toHaveBeenCalled();
			expect(loadAddonSpy).not.toHaveBeenCalled();
			expect(refreshSpy).toHaveBeenCalled();
			expect(warnSpy).toHaveBeenCalledWith(
				"[terminalSessionService] WebGL renderer context lost; falling back to the default renderer.",
			);
		} finally {
			warnSpy.mockRestore();
		}
	});

	it("recoverActiveTerminal refits without reloading renderer addons", async () => {
		const entry = await acquire("task-stable-renderer-recover");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);

		const { loadAddon: loadAddonSpy, refresh: refreshSpy } = getTerminalMocks(entry);
		loadAddonSpy.mockClear();
		refreshSpy.mockClear();

		await recoverActiveTerminal(entry);

		expect(loadAddonSpy).not.toHaveBeenCalled();
		expect(refreshSpy).toHaveBeenCalled();
	});

	it("attach is idempotent", async () => {
		const entry = await acquire("task-5");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);
		await attach(entry, wrapper);

		expect(wrapper.childElementCount).toBe(1);
	});

	it("attach rehomes an already attached terminal into the requested active wrapper", async () => {
		const entry = await acquire("project-P-123-shell-0");
		const hiddenWrapper = document.createElement("div");
		const activeWrapper = document.createElement("div");

		await attach(entry, hiddenWrapper);

		const { refresh: refreshSpy, focus: focusSpy } = getTerminalMocks(entry);
		refreshSpy.mockClear();
		focusSpy.mockClear();

		await attach(entry, activeWrapper);

		expect(hiddenWrapper.childElementCount).toBe(0);
		expect(activeWrapper.childElementCount).toBe(1);
		expect(entry.attached).toBe(true);
		expect(refreshSpy).toHaveBeenCalled();
		expect(focusSpy).toHaveBeenCalled();
	});

	it("retries the initial fit until the host div has real dimensions", async () => {
		const entry = await acquire("task-delayed-fit");
		const wrapper = document.createElement("div");
		const { fit: fitSpy } = getFitAddonMocks(entry);
		const { refresh: refreshSpy, focus: focusSpy } = getTerminalMocks(entry);
		const originalRaf = globalThis.requestAnimationFrame;

		let frame = 0;
		const rafCallbacks: FrameRequestCallback[] = [];

		globalThis.requestAnimationFrame = vi.fn(
			(callback: FrameRequestCallback) => {
				rafCallbacks.push(callback);
				return rafCallbacks.length;
			},
		);

		const widthSpy = vi.spyOn(HTMLDivElement.prototype, "clientWidth", "get")
			.mockImplementation(() => (frame >= 6 ? 800 : 0));
		const heightSpy = vi.spyOn(HTMLDivElement.prototype, "clientHeight", "get")
			.mockImplementation(() => (frame >= 6 ? 600 : 0));
		const flushFrame = () => {
			frame += 1;
			const callbacks = rafCallbacks.splice(0);
			callbacks.forEach((callback) => {
				callback(frame * 16);
			});
		};

		try {
			const attachPromise = attach(entry, wrapper);

			for (let index = 0; index < 5; index += 1) {
				flushFrame();
				await Promise.resolve();
			}

			expect(fitSpy).not.toHaveBeenCalled();
			expect(refreshSpy).not.toHaveBeenCalled();

			flushFrame();
			await attachPromise;

			expect(fitSpy).toHaveBeenCalledTimes(1);
			expect(refreshSpy).toHaveBeenCalled();
			expect(focusSpy).toHaveBeenCalled();
		} finally {
			widthSpy.mockRestore();
			heightSpy.mockRestore();
			globalThis.requestAnimationFrame = originalRaf;
		}
	});

	it("detach removes hostDiv from DOM", async () => {
		const entry = await acquire("task-6");
		const wrapper = document.createElement("div");

		await attach(entry, wrapper);
		expect(wrapper.childElementCount).toBe(1);

		detach(entry);
		expect(wrapper.childElementCount).toBe(0);
		expect(entry.attached).toBe(false);
	});

	it("detach is safe to call when not attached", async () => {
		const entry = await acquire("task-7");
		expect(() => detach(entry)).not.toThrow();
	});

	it("terminal survives detach/re-attach cycle", async () => {
		const entry = await acquire("task-13");
		await markShellPtyStarted(entry, 42);
		const wrapper1 = document.createElement("div");
		const wrapper2 = document.createElement("div");
		const { write: writeSpy } = getTerminalMocks(entry);

		await attach(entry, wrapper1);
		expect(entry.attached).toBe(true);

		// Simulate pty output while attached
		const outputCb = getListenCallback("pty-output-task-13");
		outputCb({ payload: { data: "first output", instance_id: 42 } });

		detach(entry);
		expect(entry.attached).toBe(false);

		// Output while detached still writes to terminal
		outputCb({ payload: { data: "background output", instance_id: 42 } });
		expect(writeSpy).toHaveBeenCalledWith("background output", expect.any(Function));

		// Re-acquire returns same entry
		const reacquired = await acquire("task-13");
		expect(reacquired).toBe(entry);

		// Re-attach to different wrapper
		await attach(reacquired, wrapper2);
		expect(wrapper2.childElementCount).toBe(1);
		expect(entry.attached).toBe(true);
	});

	describe("focusTerminal", () => {
		it("calls terminal.focus() for an attached entry", async () => {
			const entry = await acquire("task-focus");
			const wrapper = document.createElement("div");
			await attach(entry, wrapper);
			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			focusTerminal("task-focus");

			expect(focusSpy).toHaveBeenCalled();
		});

		it("does not move focus to an attached terminal while a modal dialog is open", async () => {
			const entry = await acquire("task-focus-modal");
			const wrapper = document.createElement("div");
			await attach(entry, wrapper);
			const dialog = document.createElement("div");
			dialog.setAttribute("role", "dialog");
			dialog.setAttribute("aria-modal", "true");
			document.body.appendChild(dialog);

			try {
				const { focus: focusSpy } = getTerminalMocks(entry);
				focusSpy.mockClear();

				focusTerminal("task-focus-modal");

				expect(focusSpy).not.toHaveBeenCalled();
			} finally {
				dialog.remove();
			}
		});

		it("does nothing for unknown taskId", () => {
			expect(() => focusTerminal("nonexistent")).not.toThrow();
		});

		it("does nothing for a detached entry", async () => {
			const entry = await acquire("task-focus-detached");
			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			focusTerminal("task-focus-detached");

			expect(focusSpy).not.toHaveBeenCalled();
		});
	});

	describe("modal focus suppression", () => {
		it("attach does not focus terminal when a modal dialog is open", async () => {
			// Simulate an open modal dialog in the DOM
			const dialog = document.createElement("div");
			dialog.setAttribute("role", "dialog");
			dialog.setAttribute("aria-modal", "true");
			document.body.appendChild(dialog);

			const entry = await acquire("task-modal");
			const wrapper = document.createElement("div");
			document.body.appendChild(wrapper);


			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			await attach(entry, wrapper);

			// Flush the requestAnimationFrame callback
			await new Promise((resolve) => requestAnimationFrame(resolve));

			expect(focusSpy).not.toHaveBeenCalled();

			// Cleanup
			document.body.removeChild(dialog);
			document.body.removeChild(wrapper);
		});

		it("attach focuses terminal when no modal dialog is open", async () => {
			const entry = await acquire("task-no-modal");
			const wrapper = document.createElement("div");
			document.body.appendChild(wrapper);


			const { focus: focusSpy } = getTerminalMocks(entry);
			focusSpy.mockClear();

			await attach(entry, wrapper);

			// Flush the requestAnimationFrame callback
			await new Promise((resolve) => requestAnimationFrame(resolve));

			expect(focusSpy).toHaveBeenCalled();

			// Cleanup
			document.body.removeChild(wrapper);
		});
	});
});
