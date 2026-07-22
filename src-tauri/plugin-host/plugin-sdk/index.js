var openforgePackageMetadataSchema_default = {
	$schema: "https://json-schema.org/draft/2020-12/schema",
	$id: "https://openforge.dev/schemas/package-openforge.v1.schema.json",
	title: "OpenForge package metadata",
	description: "Schema for package.json#openforge metadata used by OpenForge plugin packages.",
	type: "object",
	additionalProperties: false,
	required: [
		"id",
		"apiVersion",
		"displayName",
		"description"
	],
	dependentRequired: { "frontendStyles": ["frontend"] },
	properties: {
		"id": {
			"type": "string",
			"minLength": 1,
			"pattern": "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
			"description": "Explicit app-wide plugin id. Host-exposed contribution ids are qualified with this id."
		},
		"apiVersion": { "enum": [1] },
		"displayName": {
			"type": "string",
			"minLength": 1
		},
		"description": {
			"type": "string",
			"minLength": 1
		},
		"icon": {
			"type": "string",
			"minLength": 1,
			"description": "Semantic OpenForge icon key or package asset reference."
		},
		"frontend": {
			"type": "string",
			"minLength": 1,
			"description": "Path to the built frontend JavaScript entry artifact."
		},
		"frontendStyles": {
			"type": "array",
			"minItems": 1,
			"uniqueItems": true,
			"items": {
				"type": "string",
				"minLength": 1,
				"pattern": "\\.css$"
			},
			"description": "Paths to built frontend CSS artifacts. The renderer attaches them before importing the frontend entry and removes them when the plugin deactivates."
		},
		"backend": {
			"type": "string",
			"minLength": 1,
			"description": "Path to the built backend JavaScript entry artifact."
		},
		"requires": {
			"type": "array",
			"uniqueItems": true,
			"items": { "enum": [
				"commands",
				"events",
				"views",
				"injectionPoints",
				"taskPane",
				"settings",
				"background",
				"backend",
				"storage",
				"context",
				"navigation",
				"tasks",
				"projects",
				"fs",
				"shell",
				"notifications",
				"attention",
				"system.openUrl",
				"config",
				"projectConfig"
			] }
		}
	}
};
//#endregion
//#region packages/plugin-sdk/src/types.ts
function readSupportedOpenForgeApiVersions() {
	const versions = openforgePackageMetadataSchema_default.properties.apiVersion.enum;
	if (!Array.isArray(versions) || versions.length === 0 || !versions.every((version) => typeof version === "number" && Number.isInteger(version))) throw new Error("openforgePackageMetadataSchema.json properties.apiVersion.enum must contain at least one integer");
	return [...versions];
}
var SUPPORTED_OPENFORGE_API_VERSIONS = Object.freeze(readSupportedOpenForgeApiVersions());
var OPENFORGE_PLUGIN_API_VERSION = SUPPORTED_OPENFORGE_API_VERSIONS[0];
var MIN_SUPPORTED_API_VERSION = Math.min(...SUPPORTED_OPENFORGE_API_VERSIONS);
var MAX_SUPPORTED_API_VERSION = Math.max(...SUPPORTED_OPENFORGE_API_VERSIONS);
function makePluginViewKey(pluginId, viewId) {
	return `plugin:${pluginId}:${viewId}`;
}
function isPluginViewKey(value) {
	return value.startsWith("plugin:") && value.match(/^plugin:[^:]+:[^:]+$/) !== null;
}
function parsePluginViewKey(key) {
	const parts = key.split(":");
	return {
		pluginId: parts[1],
		viewId: parts[2]
	};
}
//#endregion
//#region packages/plugin-sdk/src/manifest.ts
var OPENFORGE_PACKAGE_METADATA_SCHEMA = openforgePackageMetadataSchema_default;
var OPENFORGE_PLUGIN_CAPABILITIES = openforgePackageMetadataSchema_default.properties.requires.items.enum;
var CAPABILITIES = new Set(OPENFORGE_PLUGIN_CAPABILITIES);
function isString(value) {
	return typeof value === "string";
}
function isNonEmptyString(value) {
	return isString(value) && value.length > 0;
}
function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function validateRequiredString(value, path) {
	if (!isNonEmptyString(value)) return [{
		path,
		message: "Required string"
	}];
	return [];
}
function validateOptionalString(value, path) {
	if (value === void 0) return [];
	if (!isNonEmptyString(value)) return [{
		path,
		message: "Must be a non-empty string"
	}];
	return [];
}
function validateFrontendStyles(value) {
	if (value === void 0) return [];
	if (!Array.isArray(value)) return [{
		path: "frontendStyles",
		message: "Must be an array"
	}];
	const errors = [];
	if (value.length === 0) errors.push({
		path: "frontendStyles",
		message: "Must contain at least one stylesheet path"
	});
	const seen = /* @__PURE__ */ new Set();
	value.forEach((item, index) => {
		if (!isNonEmptyString(item)) errors.push({
			path: `frontendStyles[${index}]`,
			message: "Must be a non-empty string"
		});
		else if (!item.endsWith(".css")) errors.push({
			path: `frontendStyles[${index}]`,
			message: "Must point to a built CSS artifact"
		});
		else if (seen.has(item)) errors.push({
			path: `frontendStyles[${index}]`,
			message: "Duplicate stylesheet path"
		});
		else seen.add(item);
	});
	return errors;
}
function isSupportedOpenForgeApiVersion(apiVersion) {
	return typeof apiVersion === "number" && Number.isInteger(apiVersion) && SUPPORTED_OPENFORGE_API_VERSIONS.includes(apiVersion);
}
function validateApiVersion(value) {
	if (typeof value !== "number" || !Number.isInteger(value)) return [{
		path: "apiVersion",
		message: "Required integer"
	}];
	if (!isSupportedOpenForgeApiVersion(value)) return [{
		path: "apiVersion",
		message: `API version ${value} not supported (supported: ${SUPPORTED_OPENFORGE_API_VERSIONS.join(", ")})`
	}];
	return [];
}
function validateRequires(value) {
	const errors = [];
	if (value === void 0) return errors;
	if (!Array.isArray(value)) return [{
		path: "requires",
		message: "Must be an array"
	}];
	value.forEach((item, index) => {
		const path = `requires[${index}]`;
		if (!isString(item)) {
			errors.push({
				path,
				message: "Must be a string"
			});
			return;
		}
		if (!CAPABILITIES.has(item)) errors.push({
			path,
			message: `Unknown OpenForge capability "${item}"`
		});
	});
	return errors;
}
function validateOpenForgePackageMetadata(data) {
	const errors = [];
	if (!isObject(data)) return [{
		path: "",
		message: "OpenForge package metadata must be an object"
	}];
	errors.push(...validateRequiredString(data.id, "id"));
	errors.push(...validateApiVersion(data.apiVersion));
	errors.push(...validateRequiredString(data.displayName, "displayName"));
	errors.push(...validateRequiredString(data.description, "description"));
	errors.push(...validateOptionalString(data.icon, "icon"));
	errors.push(...validateOptionalString(data.frontend, "frontend"));
	errors.push(...validateFrontendStyles(data.frontendStyles));
	if (data.frontendStyles !== void 0 && !isNonEmptyString(data.frontend)) errors.push({
		path: "frontendStyles",
		message: "Requires a frontend entry"
	});
	errors.push(...validateOptionalString(data.backend, "backend"));
	errors.push(...validateRequires(data.requires));
	if (data.contributes !== void 0) errors.push({
		path: "contributes",
		message: "Manifest contribution arrays are not supported; register contributions at runtime"
	});
	for (const key of Object.keys(data)) if (!Object.prototype.hasOwnProperty.call(OPENFORGE_PACKAGE_METADATA_SCHEMA.properties, key)) {
		if (key !== "contributes") errors.push({
			path: key,
			message: "Unknown OpenForge package metadata field"
		});
	}
	return errors;
}
var validatePluginPackageMetadata = validateOpenForgePackageMetadata;
function isOpenForgePackageMetadata(data) {
	return validateOpenForgePackageMetadata(data).length === 0;
}
var isPluginPackageMetadata = isOpenForgePackageMetadata;
//#endregion
//#region packages/plugin-sdk/src/testing.ts
var TestingSubscriptionSink = class {
	subscriptions = [];
	add(subscription) {
		if (typeof subscription === "function") {
			this.subscriptions.push(createDisposable(subscription));
			return;
		}
		if (!subscription || typeof subscription.dispose !== "function") throw new Error("context.subscriptions.add requires a disposable or cleanup function");
		this.subscriptions.push(subscription);
	}
	async disposeAll() {
		const subscriptions = this.subscriptions.splice(0).reverse();
		for (const subscription of subscriptions) await subscription.dispose();
	}
};
var TestingOpenForgeRegistryFake = class {
	pluginId;
	projectId;
	taskId;
	viewId;
	packageMetadata;
	calls;
	storage;
	frontendSubscriptions = new TestingSubscriptionSink();
	backendSubscriptions = new TestingSubscriptionSink();
	commands = /* @__PURE__ */ new Map();
	views = /* @__PURE__ */ new Map();
	taskPaneTabs = /* @__PURE__ */ new Map();
	taskUISections = /* @__PURE__ */ new Map();
	settingsSections = /* @__PURE__ */ new Map();
	eventListeners = /* @__PURE__ */ new Map();
	eventHandlers = /* @__PURE__ */ new Map();
	backendMethods = /* @__PURE__ */ new Map();
	backgroundServices = /* @__PURE__ */ new Map();
	injectionPointsMap = /* @__PURE__ */ new Map();
	claimedIds = /* @__PURE__ */ new Set();
	config = /* @__PURE__ */ new Map();
	eventListenerSequence = 0;
	cachedFrontendApi = null;
	cachedBackendApi = null;
	constructor(options = {}) {
		this.pluginId = options.pluginId ?? "test-plugin";
		this.projectId = options.projectId ?? null;
		this.taskId = options.taskId ?? null;
		this.viewId = options.viewId ?? "board";
		this.packageMetadata = options.packageMetadata ?? {
			id: this.pluginId,
			apiVersion: 1,
			displayName: this.pluginId,
			description: ""
		};
		this.calls = createTestingCalls();
		this.storage = options.storage ?? createMemoryPluginStorage(this.calls);
	}
	get frontendApi() {
		return this.createFrontendApi();
	}
	get backendApi() {
		return this.createBackendApi();
	}
	get snapshot() {
		return this.getSnapshot();
	}
	createFrontendApi() {
		if (this.cachedFrontendApi) return this.cachedFrontendApi;
		const api = {
			...this.createCommonApi(),
			views: { register: (registration) => this.registerView(registration) },
			taskUI: {
				registerTab: (registration) => this.registerTaskPaneTab(registration),
				registerSection: (registration) => this.registerTaskUISection(registration)
			},
			taskPane: { registerTab: (registration) => this.registerTaskPaneTab(registration) },
			settings: { registerSection: (registration) => this.registerSettingsSection(registration) },
			backend: {
				state: "ready",
				whenReady: async () => void 0,
				onReady: (handler) => {
					handler();
					return createDisposable(() => void 0);
				},
				invoke: async (method, payload) => this.invokeBackend(method, payload)
			},
			injectionPoints: { register: (registration) => {
				this.injectionPointsMap.set(registration.id, {
					id: registration.id,
					location: registration.location
				});
				return createDisposable(() => {
					this.injectionPointsMap.delete(registration.id);
				});
			} },
			__testing: {
				calls: this.calls,
				registry: this
			}
		};
		this.cachedFrontendApi = api;
		return api;
	}
	createBackendApi() {
		if (this.cachedBackendApi) return this.cachedBackendApi;
		const api = {
			...this.createCommonApi(),
			backend: { registerMethod: (method, registration) => this.registerBackendMethod(method, registration) },
			background: { register: (registration) => this.registerBackgroundService(registration) },
			__testing: {
				calls: this.calls,
				registry: this
			}
		};
		this.cachedBackendApi = api;
		return api;
	}
	createFrontendContext() {
		return this.createContext(this.frontendSubscriptions);
	}
	createBackendContext() {
		return this.createContext(this.backendSubscriptions);
	}
	async activateFrontend(plugin) {
		await plugin.activate(this.frontendApi, this.createFrontendContext());
	}
	async activateBackend(plugin) {
		const existingServices = new Set(this.backgroundServices.keys());
		await plugin.activate(this.backendApi, this.createBackendContext());
		await this.startBackgroundServices(existingServices);
	}
	async disposeAll() {
		await this.backendSubscriptions.disposeAll();
		await this.frontendSubscriptions.disposeAll();
	}
	getSnapshot() {
		return {
			pluginId: this.pluginId,
			projectId: this.projectId,
			views: Array.from(this.views.values()),
			taskPaneTabs: Array.from(this.taskPaneTabs.values()),
			taskUISections: Array.from(this.taskUISections.values()),
			settingsSections: Array.from(this.settingsSections.values()),
			commands: Array.from(this.commands.values()),
			eventListeners: Array.from(this.eventListeners.values()),
			backendMethods: Array.from(this.backendMethods.values()),
			backgroundServices: Array.from(this.backgroundServices.values()),
			injectionPoints: Array.from(this.injectionPointsMap.values())
		};
	}
	createContext(subscriptions) {
		return {
			pluginId: this.pluginId,
			apiVersion: 1,
			packageMetadata: this.packageMetadata,
			subscriptions
		};
	}
	startPromptContributions(projectId) {
		const raw = this.config.get(`project:${projectId}:start_prompt_contributions`);
		return Array.isArray(raw) ? raw.filter((entry) => Boolean(entry) && typeof entry === "object" && typeof entry.id === "string" && typeof entry.content === "string") : [];
	}
	createCommonApi() {
		return {
			commands: {
				register: (registration) => this.registerCommand(registration),
				invoke: async (id, payload) => this.invokeCommand(id, payload),
				invokeGlobal: async (qualifiedId, payload) => this.invokeGlobalCommand(qualifiedId, payload),
				list: async () => Array.from(this.commands.values()).map(commandDescriptor),
				listCatalog: async () => []
			},
			events: {
				on: (event, handler) => this.registerEventListener(event, handler, false),
				onGlobal: (qualifiedEvent, handler) => this.registerEventListener(qualifiedEvent, handler, true),
				emit: async (event, payload) => this.emitEvent(event, payload, false),
				emitGlobal: async (qualifiedEvent, payload) => this.emitEvent(qualifiedEvent, payload, true)
			},
			storage: this.storage,
			context: { getSnapshot: () => this.getContextSnapshot() },
			tasks: {
				list: async () => [],
				get: async () => null,
				create: async (request) => {
					this.calls.taskCreations.push(request);
					return {
						id: `mock-task-${this.calls.taskCreations.length}`,
						initial_prompt: request.initialPrompt,
						status: "backlog",
						prompt: null,
						title: null,
						title_source: null,
						title_generated_at: null,
						summary: null,
						agent: null,
						permission_mode: null,
						worktree_source: null,
						worktree_branch: null,
						handoff_notes_enabled: true,
						source_ticket_url: null,
						depends_on: request.dependsOn ?? [],
						project_id: request.projectId,
						created_at: 0,
						updated_at: 0
					};
				},
				updateSummary: async (taskId, summary) => {
					this.calls.taskSummaryUpdates.push({
						taskId,
						summary
					});
				},
				updateStatus: async (taskId, status) => {
					this.calls.taskStatusUpdates.push({
						taskId,
						status
					});
				},
				listStartPromptContributions: async (projectId) => this.startPromptContributions(projectId),
				configureStartPromptContribution: async (request) => {
					this.calls.startPromptContributionConfigurations.push(request);
					const next = [...this.startPromptContributions(request.projectId).filter((entry) => entry.id !== request.id), request].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id));
					this.config.set(`project:${request.projectId}:start_prompt_contributions`, next);
					return next;
				},
				startImplementation: async (request) => {
					this.calls.taskImplementationStarts.push(request);
					return {
						taskId: request.taskId,
						workspacePath: "/mock-workspace",
						sessionId: "mock-session"
					};
				},
				getWorkspace: async () => null,
				getLatestSession: async () => null
			},
			projects: {
				list: async () => [],
				get: async () => null
			},
			fs: {
				readDir: async () => [],
				readFile: async () => ({
					type: "text",
					content: "",
					mimeType: null,
					size: 0
				}),
				writeFile: async (request) => {
					this.calls.fsWrites.push(request);
				},
				searchFiles: async () => []
			},
			shell: {
				spawn: async (request) => {
					this.calls.shellSpawns.push(request);
					return 0;
				},
				write: async (request) => {
					this.calls.shellWrites.push(request);
				},
				resize: async (request) => {
					this.calls.shellResizes.push(request);
				},
				kill: async (request) => {
					this.calls.shellKills.push(request);
				},
				getBuffer: async (request) => {
					this.calls.shellBuffers.push(request);
					return null;
				}
			},
			notifications: { notify: async (request) => {
				this.calls.notify.push(request);
			} },
			attention: { listProjects: async () => [] },
			system: { openUrl: async (url) => {
				this.calls.openUrl.push(url);
			} },
			navigation: {
				get: () => this.getNavigationSnapshot(),
				navigate: async (request) => {
					this.calls.navigationRequests.push(request);
					return this.getNavigationSnapshot(request);
				}
			},
			config: {
				get: async (key) => this.config.has(`global:${key}`) ? this.config.get(`global:${key}`) : null,
				set: async (key, value) => {
					this.config.set(`global:${key}`, value);
					this.calls.configWrites.push({
						key,
						value,
						projectId: null
					});
				}
			},
			projectConfig: {
				get: async (key, projectId = this.projectId ?? "") => this.config.has(`project:${projectId}:${key}`) ? this.config.get(`project:${projectId}:${key}`) : null,
				set: async (key, value, projectId = this.projectId ?? "") => {
					this.config.set(`project:${projectId}:${key}`, value);
					this.calls.configWrites.push({
						key,
						value,
						projectId
					});
				}
			}
		};
	}
	getContextSnapshot() {
		return {
			pluginId: this.pluginId,
			projectId: this.projectId,
			...this.taskId === null ? {} : { taskId: this.taskId }
		};
	}
	getNavigationSnapshot(overrides = {}) {
		return {
			activeProjectId: overrides.projectId ?? this.projectId,
			currentView: overrides.viewId ?? this.viewId,
			selectedTaskId: overrides.taskId ?? this.taskId
		};
	}
	localQualifiedId(kind, id) {
		assertLocalId(kind, id);
		return `${this.pluginId}.${id.trim()}`;
	}
	claim(kind, qualifiedId) {
		const key = kind === "commands" ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`;
		if (this.claimedIds.has(key)) throw new Error(`Duplicate runtime contribution id: ${qualifiedId}`);
		this.claimedIds.add(key);
	}
	release(kind, qualifiedId) {
		const key = kind === "commands" ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`;
		this.claimedIds.delete(key);
	}
	registerCommand(registration) {
		const qualifiedId = this.localQualifiedId("commands", registration.id);
		assertTitle("commands", registration.title);
		assertFunction("commands", "handler", registration.handler);
		this.claim("commands", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			handler: registration.handler
		};
		this.commands.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.commands.delete(qualifiedId);
			this.release("commands", qualifiedId);
		});
	}
	registerView(registration) {
		const qualifiedId = this.localQualifiedId("views", registration.id);
		assertTitle("views", registration.title);
		assertFunction("views", "component", registration.component);
		this.claim("views", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.views.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.views.delete(qualifiedId);
			this.release("views", qualifiedId);
		});
	}
	registerTaskPaneTab(registration) {
		const qualifiedId = this.localQualifiedId("taskPane", registration.id);
		assertTitle("taskPane", registration.title);
		assertFunction("taskPane", "component", registration.component);
		this.claim("taskPane", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.taskPaneTabs.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.taskPaneTabs.delete(qualifiedId);
			this.release("taskPane", qualifiedId);
		});
	}
	registerTaskUISection(registration) {
		const qualifiedId = this.localQualifiedId("taskUI", registration.id);
		assertFunction("taskUI", "component", registration.component);
		this.claim("taskUI", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.taskUISections.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.taskUISections.delete(qualifiedId);
			this.release("taskUI", qualifiedId);
		});
	}
	registerSettingsSection(registration) {
		const qualifiedId = this.localQualifiedId("settings", registration.id);
		assertTitle("settings", registration.title);
		assertFunction("settings", "component", registration.component);
		this.claim("settings", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			title: registration.title.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId
		};
		this.settingsSections.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.settingsSections.delete(qualifiedId);
			this.release("settings", qualifiedId);
		});
	}
	registerBackendMethod(method, registration) {
		const qualifiedId = this.localQualifiedId("backend", method);
		assertFunction("backend", "handler", registration.handler);
		this.claim("backend", qualifiedId);
		const contribution = {
			id: method.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			registration
		};
		this.backendMethods.set(qualifiedId, contribution);
		return createDisposable(() => {
			this.backendMethods.delete(qualifiedId);
			this.release("backend", qualifiedId);
		});
	}
	registerBackgroundService(registration) {
		const qualifiedId = this.localQualifiedId("background", registration.id);
		if (registration.scope !== "global" && registration.scope !== "project" && registration.scope !== "task") throw new Error("background registration requires scope to be global, project, or task");
		assertFunction("background", "start", registration.start);
		this.claim("background", qualifiedId);
		const contribution = {
			...registration,
			id: registration.id.trim(),
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			started: false
		};
		this.backgroundServices.set(qualifiedId, contribution);
		return createDisposable(async () => {
			this.backgroundServices.delete(qualifiedId);
			this.release("background", qualifiedId);
			if (contribution.started) {
				await contribution.stop?.();
				contribution.started = false;
			}
		});
	}
	registerEventListener(event, handler, global) {
		const qualifiedId = global ? event : this.localQualifiedId("events", event);
		if (qualifiedId.trim().length === 0) throw new Error("events registration requires a non-empty id");
		assertFunction("events", "handler", handler);
		const handlers = this.eventHandlers.get(qualifiedId) ?? /* @__PURE__ */ new Set();
		handlers.add(handler);
		this.eventHandlers.set(qualifiedId, handlers);
		const listenerKey = `${qualifiedId}#${++this.eventListenerSequence}`;
		const contribution = {
			id: event,
			qualifiedId,
			pluginId: this.pluginId,
			projectId: this.projectId,
			handler,
			global
		};
		this.eventListeners.set(listenerKey, contribution);
		return createDisposable(() => {
			handlers.delete(handler);
			if (handlers.size === 0) this.eventHandlers.delete(qualifiedId);
			this.eventListeners.delete(listenerKey);
		});
	}
	async startBackgroundServices(existingServices) {
		for (const [key, service] of this.backgroundServices.entries()) {
			if (existingServices.has(key) || service.started) continue;
			await service.start();
			service.started = true;
		}
	}
	async invokeCommand(id, payload) {
		const qualifiedId = this.localQualifiedId("commands", id);
		this.calls.commandInvocations.push({
			id,
			qualifiedId,
			payload
		});
		return this.invokeGlobalCommand(qualifiedId, payload);
	}
	async invokeGlobalCommand(qualifiedId, payload) {
		this.calls.globalCommandInvocations.push({
			qualifiedId,
			payload
		});
		const command = this.commands.get(qualifiedId);
		if (!command) throw new Error(`Unknown command: ${qualifiedId}`);
		return await command.handler(payload);
	}
	async invokeBackend(method, payload) {
		const qualifiedId = this.localQualifiedId("backend", method);
		this.calls.backendInvocations.push({
			method,
			qualifiedId,
			payload
		});
		const contribution = this.backendMethods.get(qualifiedId);
		if (!contribution) throw new Error(`Backend method is not registered: ${qualifiedId}`);
		return await contribution.registration.handler(payload);
	}
	async emitEvent(event, payload, global) {
		const qualifiedEvent = global ? event : this.localQualifiedId("events", event);
		if (global) this.calls.emittedGlobalEvents.push({
			qualifiedEvent,
			payload
		});
		else this.calls.emittedEvents.push({
			event,
			qualifiedEvent,
			payload
		});
		for (const handler of Array.from(this.eventHandlers.get(qualifiedEvent) ?? [])) handler(payload);
	}
};
function createOpenForgeRegistryFake(options = {}) {
	return new TestingOpenForgeRegistryFake(options);
}
function createMockOpenForgeApi(options = {}) {
	return createMockFrontendOpenForgeApi(options);
}
function createMockFrontendOpenForgeApi(options = {}) {
	return createOpenForgeRegistryFake(options).frontendApi;
}
function createMockBackendOpenForgeApi(options = {}) {
	return createOpenForgeRegistryFake(options).backendApi;
}
function createMockPluginContext(options = {}) {
	return createOpenForgeRegistryFake(options).createFrontendContext();
}
function createMemoryPluginStorage(calls = createTestingCalls()) {
	const values = /* @__PURE__ */ new Map();
	function scope(scopeKind, scopeId) {
		const prefix = `${scopeKind}:${scopeId ?? ""}:`;
		return {
			async get(key) {
				calls.storageGets.push({
					scope: scopeKind,
					scopeId,
					key
				});
				return values.has(`${prefix}${key}`) ? values.get(`${prefix}${key}`) : null;
			},
			async set(key, value) {
				values.set(`${prefix}${key}`, value);
				calls.storageSets.push({
					scope: scopeKind,
					scopeId,
					key,
					value
				});
			},
			async delete(key) {
				values.delete(`${prefix}${key}`);
				calls.storageDeletes.push({
					scope: scopeKind,
					scopeId,
					key
				});
			}
		};
	}
	return {
		global: scope("global", null),
		project: (projectId) => scope("project", projectId),
		task: (taskId) => scope("task", taskId)
	};
}
function createTestingCalls() {
	return {
		commandInvocations: [],
		globalCommandInvocations: [],
		backendInvocations: [],
		emittedEvents: [],
		emittedGlobalEvents: [],
		openUrl: [],
		navigationRequests: [],
		notify: [],
		taskCreations: [],
		startPromptContributionConfigurations: [],
		taskImplementationStarts: [],
		taskSummaryUpdates: [],
		taskStatusUpdates: [],
		configWrites: [],
		fsWrites: [],
		shellSpawns: [],
		shellWrites: [],
		shellResizes: [],
		shellKills: [],
		shellBuffers: [],
		storageGets: [],
		storageSets: [],
		storageDeletes: []
	};
}
function commandDescriptor(command) {
	return {
		id: command.id,
		qualifiedId: command.qualifiedId,
		pluginId: command.pluginId,
		projectId: command.projectId,
		title: command.title,
		icon: command.icon,
		shortcut: command.shortcut,
		discoverable: command.discoverable ?? true,
		input: command.input,
		output: command.output
	};
}
function createDisposable(dispose) {
	let disposed = false;
	return { async dispose() {
		if (disposed) return;
		disposed = true;
		await dispose();
	} };
}
function assertLocalId(kind, id) {
	if (typeof id !== "string" || id.trim().length === 0) throw new Error(`${kind} registration requires a non-empty id`);
	const trimmed = id.trim();
	if (trimmed.startsWith("openforge.")) throw new Error(`${kind} registration cannot use openforge.* reserved namespace`);
	if (trimmed.includes(":") || trimmed.startsWith(".") || trimmed.endsWith(".") || trimmed.includes("..")) throw new Error(`${kind} registration has invalid id "${trimmed}"`);
}
function assertTitle(kind, title) {
	if (typeof title !== "string" || title.trim().length === 0) throw new Error(`${kind} registration requires a non-empty title`);
}
function assertFunction(kind, field, value) {
	if (typeof value !== "function") throw new Error(`${kind} registration requires a ${field} function`);
}
//#endregion
//#region packages/plugin-sdk/src/numberParsing.ts
var STRICT_FINITE_NUMBER_PATTERN = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
function parseStrictFiniteNumber(value) {
	if (!STRICT_FINITE_NUMBER_PATTERN.test(value)) return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : null;
}
//#endregion
//#region packages/plugin-sdk/src/projectFileTree.ts
function getProjectFileTreeDepth(path) {
	return path.split("/").length - 1;
}
function getProjectFileTreeParentPath(path) {
	const lastSlash = path.lastIndexOf("/");
	return lastSlash === -1 ? null : path.slice(0, lastSlash);
}
function buildProjectFileTree(flatEntries) {
	const nodesByPath = /* @__PURE__ */ new Map();
	const roots = [];
	for (const entry of flatEntries) nodesByPath.set(entry.path, {
		entry,
		children: [],
		level: 1,
		parentPath: getProjectFileTreeParentPath(entry.path),
		posInSet: 1,
		setSize: 1
	});
	for (const entry of flatEntries) {
		const node = nodesByPath.get(entry.path);
		if (!node) continue;
		const parent = node.parentPath ? nodesByPath.get(node.parentPath) : null;
		if (parent) parent.children.push(node);
		else roots.push(node);
	}
	assignProjectFileTreeMetadata(roots, 1);
	return roots;
}
function assignProjectFileTreeMetadata(nodes, level) {
	const setSize = nodes.length;
	nodes.forEach((node, index) => {
		node.level = level;
		node.posInSet = index + 1;
		node.setSize = setSize;
		assignProjectFileTreeMetadata(node.children, level + 1);
	});
}
function flattenVisibleProjectFileTree(nodes, expandedDirs) {
	const result = [];
	function visit(items) {
		for (const item of items) {
			result.push(item);
			if (item.entry.isDir && expandedDirs.has(item.entry.path)) visit(item.children);
		}
	}
	visit(nodes);
	return result;
}
function getProjectFileTreeItemAccessibility(node, state) {
	const isSelectedFile = !node.entry.isDir && state.selectedPath === node.entry.path;
	return {
		level: node.level,
		setSize: node.setSize,
		posInSet: node.posInSet,
		expanded: node.entry.isDir ? state.expandedDirs.has(node.entry.path) : void 0,
		current: isSelectedFile ? "true" : void 0,
		selected: !node.entry.isDir ? isSelectedFile ? "true" : "false" : void 0,
		labelledBy: !node.entry.isDir && node.entry.size !== null ? `${state.labelId} ${state.sizeId}` : state.labelId
	};
}
function formatProjectFileTreeSize(size) {
	if (size === null) return "";
	if (size < 1024) return `${size} B`;
	if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
	return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
function projectFileTreePathToId(path) {
	return `project-file-tree-${Array.from(path).map((char) => char.charCodeAt(0).toString(36)).join("-")}`;
}
function hasProjectFileTreeShortcutModifier(event) {
	return event.altKey || event.ctrlKey || event.metaKey || event.shiftKey;
}
function getProjectFileTreeKeyboardAction(event, node, state) {
	if (hasProjectFileTreeShortcutModifier(event)) return { handled: false };
	switch (event.key) {
		case "ArrowDown": return focusByOffset(node.entry.path, state.visiblePaths, 1);
		case "ArrowUp": return focusByOffset(node.entry.path, state.visiblePaths, -1);
		case "Home": return focusFirst(state.visiblePaths);
		case "End": return focusLast(state.visiblePaths);
		case "ArrowRight": return getArrowRightAction(node, state.expandedDirs);
		case "ArrowLeft": return getArrowLeftAction(node, state.expandedDirs, state.visiblePaths);
		case "Enter":
		case " ": return {
			handled: true,
			type: "activate",
			path: node.entry.path
		};
		default: return { handled: false };
	}
}
function focusByOffset(currentPath, visiblePaths, offset) {
	const currentIndex = visiblePaths.indexOf(currentPath);
	if (currentIndex === -1) return {
		handled: true,
		type: "none"
	};
	const nextPath = visiblePaths[Math.max(0, Math.min(visiblePaths.length - 1, currentIndex + offset))];
	return nextPath ? {
		handled: true,
		type: "focus",
		path: nextPath
	} : {
		handled: true,
		type: "none"
	};
}
function focusFirst(visiblePaths) {
	const firstPath = visiblePaths[0];
	return firstPath ? {
		handled: true,
		type: "focus",
		path: firstPath
	} : {
		handled: true,
		type: "none"
	};
}
function focusLast(visiblePaths) {
	const lastPath = visiblePaths.at(-1);
	return lastPath ? {
		handled: true,
		type: "focus",
		path: lastPath
	} : {
		handled: true,
		type: "none"
	};
}
function getArrowRightAction(node, expandedDirs) {
	if (!node.entry.isDir) return {
		handled: true,
		type: "none"
	};
	if (!expandedDirs.has(node.entry.path)) return {
		handled: true,
		type: "toggle",
		path: node.entry.path
	};
	const firstChild = node.children[0];
	return firstChild ? {
		handled: true,
		type: "focus",
		path: firstChild.entry.path
	} : {
		handled: true,
		type: "none"
	};
}
function getArrowLeftAction(node, expandedDirs, visiblePaths) {
	if (node.entry.isDir && expandedDirs.has(node.entry.path)) return {
		handled: true,
		type: "toggle",
		path: node.entry.path
	};
	if (node.parentPath && visiblePaths.includes(node.parentPath)) return {
		handled: true,
		type: "focus",
		path: node.parentPath
	};
	return {
		handled: true,
		type: "none"
	};
}
//#endregion
//#region packages/plugin-sdk/src/domain.ts
function isMergedPullRequest(pr) {
	return pr.state === "merged" || pr.merged_at != null;
}
function isClosedUnmergedPullRequest(pr) {
	return pr.state === "closed" && pr.merged_at == null;
}
function hasMergeConflicts(pr) {
	if (pr.state !== "open") return false;
	const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
	return mergeableState === "dirty" || mergeableState === "conflicting";
}
function mergeReadinessDetail(code, message) {
	return {
		code,
		message
	};
}
function mergeReadinessResult(pr, status, action, blockers, warnings) {
	return {
		status,
		action,
		blockers,
		warnings,
		freshness: {
			sourceSha: pr.head_sha ?? null,
			checkedAt: pr.updated_at ?? null
		}
	};
}
var MERGE_READINESS_STATUSES = [
	"ready_to_merge",
	"ready_to_enqueue",
	"queued_pull_request",
	"readiness_unknown",
	"blocked"
];
var MERGE_READINESS_ACTIONS = [
	"merge",
	"enqueue",
	"wait_for_queue",
	"wait_for_github",
	"resolve_blockers"
];
function isMergeReadinessStatus(value) {
	return MERGE_READINESS_STATUSES.includes(value);
}
function isMergeReadinessAction(value) {
	return MERGE_READINESS_ACTIONS.includes(value);
}
function parseMergeReadinessDetails(value) {
	if (Array.isArray(value)) return value;
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed.filter((detail) => typeof detail?.code === "string" && typeof detail?.message === "string") : [];
	} catch {
		return [];
	}
}
function isUnresolvedConversationDetail(detail) {
	return detail.code === "unresolved_conversations";
}
function hasNoPublishedChecksForUnstableMergeability(pr) {
	const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
	const ciStatus = pr.ci_status?.toLowerCase() ?? null;
	return mergeableState === "unstable" && (ciStatus === null || ciStatus === "none");
}
function downgradeNoCheckPersistedFailures(pr, blockers) {
	if (!hasNoPublishedChecksForUnstableMergeability(pr)) return blockers;
	return blockers.map((blocker) => blocker.code === "checks_failed" ? mergeReadinessDetail("checks_pending", "Required checks are still running.") : blocker);
}
function removeUnresolvedConversationDetails(details) {
	return details.filter((detail) => !isUnresolvedConversationDetail(detail));
}
function shouldIgnorePersistedUnresolvedConversationDetails(pr, blockers, warnings) {
	return pr.unaddressed_comment_count === 0 && (blockers.some(isUnresolvedConversationDetail) || warnings.some(isUnresolvedConversationDetail));
}
function isPersistedMergeReadinessCurrent(pr) {
	const sourceSha = pr.readiness_source_head_sha ?? null;
	const headSha = pr.head_sha ?? null;
	if (!sourceSha || !headSha || sourceSha !== headSha) return false;
	const checkedAt = pr.readiness_updated_at ?? null;
	const updatedAt = pr.updated_at ?? null;
	return checkedAt !== null && (updatedAt === null || checkedAt >= updatedAt);
}
function getPersistedMergeReadiness(pr) {
	const status = pr.merge_readiness_status ?? null;
	const action = pr.merge_readiness_action ?? null;
	if (!isMergeReadinessStatus(status) || !isMergeReadinessAction(action)) return null;
	if (!isPersistedMergeReadinessCurrent(pr)) return null;
	let blockers = downgradeNoCheckPersistedFailures(pr, parseMergeReadinessDetails(pr.merge_readiness_blockers));
	let warnings = parseMergeReadinessDetails(pr.merge_readiness_warnings);
	if (shouldIgnorePersistedUnresolvedConversationDetails(pr, blockers, warnings)) {
		blockers = removeUnresolvedConversationDetails(blockers);
		warnings = removeUnresolvedConversationDetails(warnings);
		if (status === "blocked" && blockers.length === 0) return null;
	}
	return {
		status,
		action,
		blockers,
		warnings,
		freshness: {
			sourceSha: pr.readiness_source_head_sha ?? null,
			checkedAt: pr.readiness_updated_at ?? null
		}
	};
}
function hasMergeReadinessOptions(options) {
	return options.requireBranchUpToDate === true || options.requireConversationResolution === true || options.requireMergeQueue === true;
}
/**
* Explains whether a pull request is ready for a direct merge, queue enqueueing,
* waiting on GitHub/merge queue, or blocked by hard requirements.
*/
function getMergeReadiness(pr, options = {}) {
	const warnings = [];
	const blockers = [];
	if (pr.state !== "open") {
		blockers.push(mergeReadinessDetail(pr.state === "merged" ? "already_merged" : "pull_request_closed", pr.state === "merged" ? "Pull request is already merged." : "Pull request is closed."));
		return mergeReadinessResult(pr, "blocked", "resolve_blockers", blockers, warnings);
	}
	const persisted = hasMergeReadinessOptions(options) ? null : getPersistedMergeReadiness(pr);
	if (persisted) return persisted;
	const mergeableState = pr.mergeable_state?.toLowerCase() ?? null;
	const ciStatus = pr.ci_status?.toLowerCase() ?? null;
	const reviewStatus = pr.review_status?.toLowerCase() ?? null;
	const unaddressedCommentCount = pr.unaddressed_comment_count ?? 0;
	if (pr.draft === true) blockers.push(mergeReadinessDetail("draft", "Pull request is still marked as draft."));
	if (reviewStatus === "changes_requested") blockers.push(mergeReadinessDetail("changes_requested", "Review changes have been requested."));
	if (ciStatus === "pending" || ciStatus === "queued" || ciStatus === "in_progress") blockers.push(mergeReadinessDetail("checks_pending", "Required checks are still running."));
	else if (ciStatus === "failure" || ciStatus === "error" || ciStatus === "cancelled" || ciStatus === "timed_out" || ciStatus === "action_required") blockers.push(mergeReadinessDetail("checks_failed", "Required checks are failing."));
	const hasFailedChecks = blockers.some((blocker) => blocker.code === "checks_failed");
	const hasPendingChecks = blockers.some((blocker) => blocker.code === "checks_pending");
	if (mergeableState === "unstable" && !hasFailedChecks && !hasPendingChecks) blockers.push(hasNoPublishedChecksForUnstableMergeability(pr) ? mergeReadinessDetail("checks_pending", "Required checks are still running.") : mergeReadinessDetail("checks_failed", "GitHub reports failing or unstable required checks."));
	if (mergeableState === "dirty" || mergeableState === "conflicting") blockers.push(mergeReadinessDetail("merge_conflict", "Pull request has merge conflicts."));
	else if (mergeableState === "blocked") blockers.push(mergeReadinessDetail("mergeability_blocked", "GitHub reports that mergeability is blocked."));
	else if (mergeableState === "behind") if (options.requireBranchUpToDate === true) blockers.push(mergeReadinessDetail("branch_out_of_date", "Branch must be updated before merging."));
	else warnings.push(mergeReadinessDetail("branch_behind", "Branch is behind the base branch."));
	if (unaddressedCommentCount > 0) {
		const detail = mergeReadinessDetail("unresolved_conversations", "Pull request has unresolved conversations.");
		if (options.requireConversationResolution === true) blockers.push(detail);
		else warnings.push(detail);
	}
	if (blockers.length > 0) return mergeReadinessResult(pr, "blocked", "resolve_blockers", blockers, warnings);
	if (pr.is_queued === true) return mergeReadinessResult(pr, "queued_pull_request", "wait_for_queue", blockers, warnings);
	const hasDirectMergeability = mergeableState === "clean" || mergeableState === "behind";
	const hasNoCiStatus = ciStatus === null || ciStatus === "none";
	const hasNoReviewStatus = reviewStatus === null || reviewStatus === "none";
	const isUnprotectedFallback = mergeableState === null && pr.mergeable === true && hasNoCiStatus && hasNoReviewStatus;
	if (isUnprotectedFallback) warnings.push(mergeReadinessDetail("unprotected_fallback", "Using simple mergeability because no protected-branch checks or review state are available."));
	if (hasDirectMergeability || isUnprotectedFallback) return mergeReadinessResult(pr, options.requireMergeQueue === true ? "ready_to_enqueue" : "ready_to_merge", options.requireMergeQueue === true ? "enqueue" : "merge", blockers, warnings);
	if (mergeableState === "unknown" || pr.mergeable === null || mergeableState === null && pr.mergeable !== false) {
		warnings.push(mergeReadinessDetail("mergeability_unknown", "GitHub has not reported definitive mergeability yet."));
		return mergeReadinessResult(pr, "readiness_unknown", "wait_for_github", blockers, warnings);
	}
	blockers.push(mergeReadinessDetail("mergeability_blocked", "Pull request is not mergeable."));
	return mergeReadinessResult(pr, "blocked", "resolve_blockers", blockers, warnings);
}
/** Check if a PR is ready for a direct merge action. */
function isReadyToMerge(pr, options) {
	const readiness = getMergeReadiness(pr, options);
	return readiness.status === "ready_to_merge" && readiness.action === "merge";
}
/** Check if a user-initiated merge affordance may be shown/executed now. */
function canMergePullRequest(pr) {
	const readiness = getMergeReadiness(pr);
	return readiness.status === "ready_to_merge" && readiness.action === "merge";
}
/** Check if GitHub reports a PR as queued in a merge queue. */
function isQueuedForMerge(pr) {
	return pr.state === "open" && pr.is_queued;
}
/** Preserves optimistic and definitive states across transient background syncs */
function preservePullRequestState(oldPr, newPr) {
	if (!oldPr) return newPr;
	const result = { ...newPr };
	if (oldPr.state === "merged" && result.state === "open") {
		result.state = "merged";
		result.merged_at = oldPr.merged_at;
	}
	const isTransient = result.mergeable === null || result.mergeable_state === "unknown" || result.mergeable_state === null;
	const oldIsDefinitive = oldPr.mergeable_state !== "unknown" && oldPr.mergeable_state !== null;
	if (isTransient && oldIsDefinitive) {
		result.mergeable = oldPr.mergeable;
		result.mergeable_state = oldPr.mergeable_state;
	}
	const oldReadiness = getPersistedMergeReadiness(oldPr);
	const newReadiness = getPersistedMergeReadiness(result);
	const sameReadinessSource = (oldPr.readiness_source_head_sha ?? oldPr.head_sha ?? null) === (result.readiness_source_head_sha ?? result.head_sha ?? null);
	const newReadinessIsTransient = newReadiness === null || newReadiness.status === "readiness_unknown";
	if (sameReadinessSource && oldReadiness && oldReadiness.status !== "readiness_unknown" && newReadinessIsTransient) {
		result.merge_readiness_status = oldPr.merge_readiness_status;
		result.merge_readiness_action = oldPr.merge_readiness_action;
		result.merge_readiness_blockers = oldPr.merge_readiness_blockers;
		result.merge_readiness_warnings = oldPr.merge_readiness_warnings;
		result.readiness_source_head_sha = oldPr.readiness_source_head_sha;
		result.readiness_updated_at = oldPr.readiness_updated_at;
		result.merge_group_sha = oldPr.merge_group_sha;
		result.required_checks_policy_known = oldPr.required_checks_policy_known;
		result.required_reviews_policy_known = oldPr.required_reviews_policy_known;
		result.merge_queue_required = oldPr.merge_queue_required;
		result.merge_queue_state = oldPr.merge_queue_state;
	}
	return result;
}
function parseCheckRuns(json) {
	if (!json) return [];
	try {
		return JSON.parse(json);
	} catch {
		return [];
	}
}
/** Split check runs into visible (non-passing) and a count of hidden passing checks. */
function splitCheckRuns(checks) {
	const visible = [];
	let passingCount = 0;
	for (const check of checks) if (check.status === "completed" && check.conclusion === "success") passingCount++;
	else visible.push(check);
	return {
		visible,
		passingCount
	};
}
//#endregion
export { MAX_SUPPORTED_API_VERSION, MIN_SUPPORTED_API_VERSION, OPENFORGE_PACKAGE_METADATA_SCHEMA, OPENFORGE_PLUGIN_API_VERSION, OPENFORGE_PLUGIN_CAPABILITIES, SUPPORTED_OPENFORGE_API_VERSIONS, TestingOpenForgeRegistryFake, TestingSubscriptionSink, buildProjectFileTree, canMergePullRequest, createMemoryPluginStorage, createMockBackendOpenForgeApi, createMockFrontendOpenForgeApi, createMockOpenForgeApi, createMockPluginContext, createOpenForgeRegistryFake, createTestingCalls, flattenVisibleProjectFileTree, formatProjectFileTreeSize, getMergeReadiness, getProjectFileTreeDepth, getProjectFileTreeItemAccessibility, getProjectFileTreeKeyboardAction, getProjectFileTreeParentPath, hasMergeConflicts, hasProjectFileTreeShortcutModifier, isClosedUnmergedPullRequest, isMergedPullRequest, isOpenForgePackageMetadata, isPluginPackageMetadata, isPluginViewKey, isQueuedForMerge, isReadyToMerge, isSupportedOpenForgeApiVersion, makePluginViewKey, parseCheckRuns, parsePluginViewKey, parseStrictFiniteNumber, preservePullRequestState, projectFileTreePathToId, splitCheckRuns, validateOpenForgePackageMetadata, validatePluginPackageMetadata };
