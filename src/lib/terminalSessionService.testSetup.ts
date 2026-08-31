import { afterEach, beforeEach, type Mock, vi } from "vitest";
import { agentTerminalSessions } from './terminalSessionService'

const { releaseAll } = agentTerminalSessions

type ListenCallback = (event: unknown) => void;
type UnlistenMock = Mock<() => void>;

// Track listen callbacks so tests can simulate events
export const listenCallbacks = new Map<string, ListenCallback>();
export const unlistenFns: UnlistenMock[] = [];
export let webLinksHandler: ((event: MouseEvent, uri: string) => void) | null = null;
let webglConstructorShouldThrow = false;
let webglLoadShouldThrow = false;
let webglLoadShouldTriggerContextLoss = false;
export const webglContextLossListeners: Array<() => void> = [];
export const webglContextLossDisposables: UnlistenMock[] = [];
export let fontLoadMock: Mock;
const originalDocumentFonts = document.fonts;

interface TerminalMockOptions {
	fontFamily?: string;
	linkHandler?: {
		activate: (event: MouseEvent, text: string, range: unknown) => void;
	};
}

interface TerminalMock {
	options: TerminalMockOptions;
	open: Mock;
	write: Mock;
	dispose: Mock;
	loadAddon: Mock;
	attachCustomKeyEventHandler: Mock;
	refresh: Mock;
	focus: Mock;
	reset: Mock;
	cols: number;
	rows: number;
}

interface FitAddonMock {
	fit: Mock;
}

interface WebglAddonMock {
	dispose: Mock;
}

const terminalInstances: TerminalMock[] = [];
const fitAddonInstances: FitAddonMock[] = [];
export const webglAddonInstances: WebglAddonMock[] = [];

export function getTerminalFontFamily(terminal: unknown): string | undefined {
	if (
		typeof terminal !== "object" ||
		terminal === null ||
		!("options" in terminal)
	) {
		return undefined;
	}

	const options = terminal.options;
	if (
		typeof options !== "object" ||
		options === null ||
		!("fontFamily" in options)
	) {
		return undefined;
	}

	return typeof options.fontFamily === "string"
		? options.fontFamily
		: undefined;
}

export function requireValue<T>(value: T | null | undefined, message: string): T {
	if (value == null) {
		throw new Error(message);
	}

	return value;
}

export function getTerminalMockAt(index: number): TerminalMock {
  return requireValue(terminalInstances[index], `Expected xterm adapter instance ${index}`)
}

export function getTerminalMocksAt(index: number) {
  const terminal = getTerminalMockAt(index)
  return {
    open: vi.mocked(terminal.open),
    write: vi.mocked(terminal.write),
    dispose: vi.mocked(terminal.dispose),
    loadAddon: vi.mocked(terminal.loadAddon),
    attachCustomKeyEventHandler: vi.mocked(terminal.attachCustomKeyEventHandler),
    refresh: vi.mocked(terminal.refresh),
    focus: vi.mocked(terminal.focus),
    reset: vi.mocked(terminal.reset),
  }
}

export function getLoadedAddonNamesAt(index: number): string[] {
  return vi.mocked(getTerminalMockAt(index).loadAddon).mock.calls
    .map(call => Object.getPrototypeOf(call[0])?.constructor?.name ?? '')
}

export function getListenCallback(eventName: string): ListenCallback {
	return requireValue(
		listenCallbacks.get(eventName),
		`Missing listen callback for ${eventName}`,
	);
}

export function getWebLinksHandler(): (event: MouseEvent, uri: string) => void {
	return requireValue(
		webLinksHandler,
		"Expected WebLinks handler to be registered",
	);
}


vi.mock("./desktopIpc", () => ({
	listenDesktopEvent: vi.fn(async (eventName: string, cb: (event: unknown) => void) => {
		listenCallbacks.set(eventName, cb);
		const unlisten = vi.fn();
		unlistenFns.push(unlisten);
		return unlisten;
	}),
}));

vi.mock("@xterm/xterm", () => {
	class Terminal {
		options: TerminalMockOptions;
		constructor(options: TerminalMockOptions = {}) {
			this.options = options;
			terminalInstances.push(this);
		}
		open = vi.fn();
		write = vi.fn((_data: string | Uint8Array, callback?: () => void) => callback?.());
		dispose = vi.fn();
		onData = vi.fn().mockReturnValue({ dispose: vi.fn() });
		onWriteParsed = vi.fn().mockReturnValue({ dispose: vi.fn() });
		onRender = vi.fn().mockReturnValue({ dispose: vi.fn() });
		attachCustomKeyEventHandler = vi.fn();
		loadAddon = vi.fn((addon: unknown) => {
			if (Object.getPrototypeOf(addon)?.constructor?.name !== "WebglAddon") {
				return;
			}

			if (webglLoadShouldTriggerContextLoss) {
				webglContextLossListeners[0]?.();
			}

			if (webglLoadShouldThrow) {
				throw new Error("WebGL renderer load failed");
			}
		});
		refresh = vi.fn();
		focus = vi.fn();
		blur = vi.fn();
		reset = vi.fn();
		cols = 80;
		rows = 24;
	}
	return { Terminal };
});

vi.mock("@xterm/addon-fit", () => {
	class FitAddon {
		constructor() {
			fitAddonInstances.push(this);
		}
		fit = vi.fn();
		proposeDimensions = vi.fn().mockReturnValue({ cols: 80, rows: 24 });
	}
	return { FitAddon };
});

vi.mock("@xterm/addon-web-links", () => {
	class WebLinksAddon {
		constructor(handler?: (event: MouseEvent, uri: string) => void) {
			webLinksHandler = handler ?? null;
		}

		activate = vi.fn();
		dispose = vi.fn();
	}

	return { WebLinksAddon };
});

vi.mock("@xterm/addon-webgl", () => {
	class WebglAddon {
		constructor() {
			if (webglConstructorShouldThrow) {
				throw new Error("WebGL renderer unavailable");
			}
			webglAddonInstances.push(this);
		}

		onContextLoss = vi.fn((listener: () => void) => {
			webglContextLossListeners.push(listener);
			const disposable = vi.fn();
			webglContextLossDisposables.push(disposable);
			return { dispose: disposable };
		});
		activate = vi.fn();
		dispose = vi.fn();
	}

	return { WebglAddon };
});

vi.mock("./ipc", () => ({
	writePty: vi.fn().mockResolvedValue(undefined),
	resizePty: vi.fn().mockResolvedValue(undefined),
	getPtyBuffer: vi.fn().mockResolvedValue({ buffer: null, isLive: false, instanceId: null }),
	openUrl: vi.fn().mockResolvedValue(undefined),
}));

const MockResizeObserver: typeof ResizeObserver = class MockResizeObserver
	implements ResizeObserver
{
	observe = vi.fn<(target: Element, options?: ResizeObserverOptions) => void>();
	unobserve = vi.fn<(target: Element) => void>();
	disconnect = vi.fn<() => void>();
};

const MockIntersectionObserver: typeof IntersectionObserver = class MockIntersectionObserver
	implements IntersectionObserver
{
	readonly root: Element | Document | null = null;
	readonly rootMargin = "";
	readonly scrollMargin = "";
	readonly thresholds: number[] = [];

	private readonly callback: IntersectionObserverCallback;

	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
	}
	disconnect = vi.fn<() => void>();
	observe = vi.fn<(target: Element) => void>((target) => {
		this.callback([{ isIntersecting: true, target } as IntersectionObserverEntry], this);
	});
	takeRecords = vi.fn<() => IntersectionObserverEntry[]>().mockReturnValue([]);
	unobserve = vi.fn<(target: Element) => void>();
};

// Stub browser APIs not available in jsdom
globalThis.ResizeObserver = MockResizeObserver;
globalThis.IntersectionObserver = MockIntersectionObserver;

Object.defineProperty(HTMLDivElement.prototype, "clientWidth", {
	configurable: true,
	get() {
		return 800;
	},
});

Object.defineProperty(HTMLDivElement.prototype, "clientHeight", {
	configurable: true,
	get() {
		return 600;
	},
});


export function setWebglConstructorFailure(enabled: boolean): void {
	webglConstructorShouldThrow = enabled;
}

export function setWebglLoadFailure(enabled: boolean): void {
	webglLoadShouldThrow = enabled;
}

export function setWebglContextLossOnLoad(enabled: boolean): void {
	webglLoadShouldTriggerContextLoss = enabled;
}

beforeEach(() => {
	releaseAll();
	listenCallbacks.clear();
	unlistenFns.length = 0;
	webLinksHandler = null;
	webglConstructorShouldThrow = false;
	webglLoadShouldThrow = false;
	webglLoadShouldTriggerContextLoss = false;
	webglContextLossListeners.length = 0;
	webglContextLossDisposables.length = 0;
	terminalInstances.length = 0;
	fitAddonInstances.length = 0;
	webglAddonInstances.length = 0;
	fontLoadMock = vi.fn().mockResolvedValue([]);
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: {
			ready: Promise.resolve(),
			load: fontLoadMock,
		},
	});
	vi.clearAllMocks();
});

afterEach(() => {
	Object.defineProperty(document, "fonts", {
		configurable: true,
		value: originalDocumentFonts,
	});
	releaseAll();
});
