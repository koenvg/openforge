import {
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	getLoadedAddonNames,
	getTerminalMock,
	getTerminalMocks,
	getWebLinksHandler,
	installTerminalPoolTestHarness,
	getTaskLinkOpenMock,
	webLinksHandler,
	terminalPoolApi,
	ipcApi,
} from "./terminalPool.testHarness";

const { acquire } = terminalPoolApi;
const { writePty } = ipcApi;

describe("terminalPool input", () => {
	installTerminalPoolTestHarness();

	it("routes detected Agent Terminal Surface links with their Task context", async () => {
		const entry = await acquire("T-42");
		const { loadAddon: loadAddonSpy } = getTerminalMocks(entry);
		const event = new MouseEvent("click");
		const preventDefault = vi.spyOn(event, "preventDefault");
		const stopPropagation = vi.spyOn(event, "stopPropagation");

		expect(getLoadedAddonNames(entry).slice(0, 2)).toEqual(["FitAddon", "WebLinksAddon"]);
		expect(entry.view.imageProtocol).toBe("iterm2");
		expect(loadAddonSpy).toHaveBeenCalledTimes(4);
		expect(webLinksHandler).not.toBeNull();

		getWebLinksHandler()(event, "https://example.com/pool");

		expect(preventDefault).toHaveBeenCalled();
		expect(stopPropagation).toHaveBeenCalled();
		expect(getTaskLinkOpenMock()).toHaveBeenCalledWith({ taskId: "T-42", url: "https://example.com/pool" });
	});

	it("routes OSC 8 Agent Terminal Surface links instead of xterm default browser handling", async () => {
		const entry = await acquire("T-43");
		const event = new MouseEvent("click");
		const preventDefault = vi.spyOn(event, "preventDefault");
		const stopPropagation = vi.spyOn(event, "stopPropagation");

		getTerminalMock(entry).options.linkHandler?.activate(
			event,
			"https://example.com/osc8",
			{ start: { x: 1, y: 1 }, end: { x: 10, y: 1 } },
		);

		expect(preventDefault).toHaveBeenCalled();
		expect(stopPropagation).toHaveBeenCalled();
		expect(getTaskLinkOpenMock()).toHaveBeenCalledWith({ taskId: "T-43", url: "https://example.com/osc8" });
	});

	it("agent terminals send Ctrl+J once and suppress xterm Shift+Enter keydown/keypress handling", async () => {
		const agentEntry = await acquire("T-120");
		const shellEntry = await acquire("T-120-shell-0");
		agentEntry.ptyActive = true;
		shellEntry.ptyActive = true;
		const { attachCustomKeyEventHandler: agentKeyHandlerSpy } = getTerminalMocks(agentEntry);
		const { attachCustomKeyEventHandler: shellKeyHandlerSpy } = getTerminalMocks(shellEntry);

		expect(shellKeyHandlerSpy).not.toHaveBeenCalled();
		expect(agentKeyHandlerSpy).toHaveBeenCalledTimes(1);
		const handleKeyEvent = agentKeyHandlerSpy.mock.calls[0][0];
		const keydownEvent = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true });
		const keypressEvent = new KeyboardEvent("keypress", { key: "Enter", shiftKey: true, cancelable: true });
		const keydownStopPropagation = vi.spyOn(keydownEvent, "stopPropagation");
		const keypressStopPropagation = vi.spyOn(keypressEvent, "stopPropagation");

		const handledKeydown = handleKeyEvent(keydownEvent);
		const handledKeypress = handleKeyEvent(keypressEvent);

		expect(handledKeydown).toBe(false);
		expect(handledKeypress).toBe(false);
		expect(keydownEvent.defaultPrevented).toBe(true);
		expect(keypressEvent.defaultPrevented).toBe(true);
		expect(keydownStopPropagation).toHaveBeenCalledTimes(1);
		expect(keypressStopPropagation).toHaveBeenCalledTimes(1);
		expect(writePty).toHaveBeenCalledTimes(1);
		expect(writePty).toHaveBeenCalledWith("T-120", "\n");
		expect(writePty).not.toHaveBeenCalledWith("T-120", "\r");
		expect(writePty).not.toHaveBeenCalledWith("T-120", "\u001b[13;2u");

		vi.mocked(writePty).mockClear();
		agentEntry.ptyActive = false;
		const inactiveKeydownEvent = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, cancelable: true });
		const inactiveStopPropagation = vi.spyOn(inactiveKeydownEvent, "stopPropagation");
		const handledInactive = handleKeyEvent(inactiveKeydownEvent);

		expect(handledInactive).toBe(false);
		expect(inactiveKeydownEvent.defaultPrevented).toBe(true);
		expect(inactiveStopPropagation).toHaveBeenCalledTimes(1);
		expect(writePty).not.toHaveBeenCalled();
	});
});
