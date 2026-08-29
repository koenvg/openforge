import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock } = vi.hoisted(() => ({
	invokeMock: vi.fn(),
}));

vi.mock("./desktopIpc", () => ({
	invokeDesktopCommand: invokeMock,
	isElectronDesktopBridgeAvailable: vi.fn(() => true),
}));

import * as ipcModule from "./ipc";
import {
  approveCompanionPairing,
  cancelCompanionPairing,
  checkCodexInstalled,
  checkPiInstalled,
  createTask,
  deleteTaskLabel,
  enqueuePullRequest,
  fsSearchFiles,
  fsWriteFile,
  getAllTasks,
  getTaskRelationshipReferences,
  getTaskAttention,
  getTaskLanes,
  getCommitBatchFileContents,
  getDeveloperLogSnapshot,
  getProcessMemoryHistory,
  getDeveloperLogs,
  getCompanionPairingStatus,
  getTaskBatchFileContents,
  getPtyBuffer,
  getResolvedAiProvider,
  listCompanionDevices,
  removeCompanionDevice,
  listGitBranches,
  registerBuiltinPlugin,
  installPluginFromGit,
  installPluginFromLocal,
  installPluginFromNpm,
  rejectCompanionPairing,
  revokeCompanionDevice,
  installPluginFromSource,
  scanPluginFolder,
  killPty,
  killShellsForTask,
  repoHasCommits,
  resizePty,
  spawnShellPty,
  startCompanionPairing,
  setCompanionTailscaleHostname,
  setProcessMemoryHistoryEnabled,
  startImplementation,
  transcribeAudio,
  updateTaskInitialPrompt,
  updateTaskSourceTicketUrl,
  writePty,
} from "./ipc";

type PtyPayloadFixture = {
	name: string;
	command: string;
	payload: Record<string, unknown>;
}

const ptyPayloadContracts = JSON.parse(
	readFileSync(resolve(process.cwd(), "src-tauri/src/app_invoke/tests/fixtures/pty_payload_contracts.json"), "utf8"),
) as { valid: PtyPayloadFixture[] };

function ptyFixture(command: string, name: string): PtyPayloadFixture {
	const fixture = ptyPayloadContracts.valid.find((entry) => entry.command === command && entry.name === name);
	if (!fixture) throw new Error(`Missing PTY payload fixture ${command}/${name}`);
	return fixture;
}

describe('ipc Companion pairing commands', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue(undefined)
  })

  it('keeps desktop pairing decisions behind narrow camelCase commands', async () => {
    await startCompanionPairing()
    await setCompanionTailscaleHostname('forge-mac.example.ts.net')
    await getCompanionPairingStatus()
    await cancelCompanionPairing('session-1')
    await approveCompanionPairing('request-1')
    await rejectCompanionPairing('request-2')
    await listCompanionDevices()
    await revokeCompanionDevice('device-1')
    await removeCompanionDevice('device-1')

    expect(invokeMock.mock.calls).toEqual([
      ['start_companion_pairing'],
      ['set_companion_tailscale_hostname', { hostname: 'forge-mac.example.ts.net' }],
      ['get_companion_pairing_status'],
      ['cancel_companion_pairing', { sessionId: 'session-1' }],
      ['approve_companion_pairing', { requestId: 'request-1' }],
      ['reject_companion_pairing', { requestId: 'request-2' }],
      ['list_companion_devices'],
      ['revoke_companion_device', { deviceId: 'device-1' }],
      ['remove_companion_device', { deviceId: 'device-1' }],
    ])
  })
})

describe("ipc GitHub pull request commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("sends camelCase payload for enqueuePullRequest", async () => {
    await enqueuePullRequest("T-42", 1001, "head-sha");

    expect(invokeMock).toHaveBeenCalledWith("enqueue_task_pull_request", {
      taskId: "T-42",
      prId: 1001,
      expectedHeadSha: "head-sha",
    });
  });
});

describe("ipc resolved provider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue("codex");
  });

  it("requests the backend-resolved provider for a project", async () => {
    await expect(getResolvedAiProvider("P-1")).resolves.toBe("codex");

    expect(invokeMock).toHaveBeenCalledWith("resolve_ai_provider", { projectId: "P-1" });
  });
});

describe("ipc task attention projection", () => {
  it("requests the backend-owned Task-only attention rows", async () => {
    invokeMock.mockResolvedValue([]);

    await expect(getTaskAttention()).resolves.toEqual([]);

    expect(invokeMock).toHaveBeenCalledWith("get_task_attention");
  });

  it("requests the backend-owned four-lane rows", async () => {
    const lanes = { focus: [], in_flight: [], out_of_focus: [], backlog: [] };
    invokeMock.mockResolvedValue(lanes);

    await expect(getTaskLanes()).resolves.toEqual(lanes);

    expect(invokeMock).toHaveBeenCalledWith("get_task_lanes");
  });
});

describe("ipc task label commands", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("sends camelCase payload for deleting a project task label", async () => {
    await deleteTaskLabel(42);

    expect(invokeMock).toHaveBeenCalledWith("delete_task_label", { labelId: 42 });
  });
});

describe("ipc developer logs", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue([]);
  });

  it("requests a file-backed log snapshot through the typed wrapper", async () => {
    await getDeveloperLogSnapshot(1000);

    expect(invokeMock).toHaveBeenCalledWith("get_developer_log_snapshot", { limit: 1000 });
  });

  it("can request a bounded main-process log snapshot when a limit is provided", async () => {
    await getDeveloperLogs(150);

    expect(invokeMock).toHaveBeenCalledWith("get_developer_logs", { limit: 150 });
  });
});

describe('ipc process memory history', () => {
  beforeEach(() => {
    invokeMock.mockReset()
    invokeMock.mockResolvedValue({ enabled: false, samples: [] })
  })

  it('uses typed history commands with a camelCase opt-in payload', async () => {
    await getProcessMemoryHistory()
    await setProcessMemoryHistoryEnabled(true)

    expect(invokeMock.mock.calls).toEqual([
      ['get_process_memory_history'],
      ['set_process_memory_history_enabled', { enabled: true }],
    ])
  })
})

describe("ipc spawnShellPty", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(7);
	});

	it("sends terminalIndex in the invoke payload for shell tabs", async () => {
		await spawnShellPty("T-42", "/tmp/worktree", 80, 24, 1);

		expect(invokeMock).toHaveBeenCalledWith("pty_spawn_shell", {
			taskId: "T-42",
			cwd: "/tmp/worktree",
			cols: 80,
			rows: 24,
			terminalIndex: 1,
			terminalImageProtocol: null,
		});
	});

	it("advertises iTerm images only when the active terminal requests them", async () => {
		await spawnShellPty("T-42", "/tmp/worktree", 80, 24, 1, "iterm2");

		expect(invokeMock).toHaveBeenCalledWith("pty_spawn_shell", {
			taskId: "T-42",
			cwd: "/tmp/worktree",
			cols: 80,
			rows: 24,
			terminalIndex: 1,
			terminalImageProtocol: "iterm2",
		});
	});

	it("threads active image support into Pi implementation starts", async () => {
		invokeMock.mockResolvedValue({});

		await startImplementation("T-42", "/tmp/worktree", null, "iterm2");

		expect(invokeMock).toHaveBeenCalledWith("start_implementation", {
			taskId: "T-42",
			repoPath: "/tmp/worktree",
			divergenceResolution: null,
			terminalImageProtocol: "iterm2",
			promptPrefix: null,
		});
	});

	it("keeps renderer PTY payloads aligned with the Rust decoder contract fixtures", async () => {
		const spawnShell = ptyFixture("pty_spawn_shell", "spawn_shell_with_index");
		await spawnShellPty("T-pty", "/tmp/openforge-worktree", 80, 24, 2);
		expect(invokeMock).toHaveBeenLastCalledWith(spawnShell.command, spawnShell.payload);

		const write = ptyFixture("pty_write", "write_pty");
		await writePty("T-pty-shell-2", "echo ready\n");
		expect(invokeMock).toHaveBeenLastCalledWith(write.command, write.payload);

		const resize = ptyFixture("pty_resize", "resize_pty");
		await resizePty("T-pty-shell-2", 120, 40);
		expect(invokeMock).toHaveBeenLastCalledWith(resize.command, resize.payload);

		const kill = ptyFixture("pty_kill", "kill_pty");
		await killPty("T-pty-shell-2");
		expect(invokeMock).toHaveBeenLastCalledWith(kill.command, kill.payload);

		const killShells = ptyFixture("pty_kill_shells_for_task", "kill_shells_for_task");
		await killShellsForTask("T-pty");
		expect(invokeMock).toHaveBeenLastCalledWith(killShells.command, killShells.payload);

		const buffer = ptyFixture("get_pty_buffer", "get_pty_buffer");
		await getPtyBuffer("T-pty-shell-2");
		expect(invokeMock).toHaveBeenLastCalledWith(buffer.command, buffer.payload);
	});

	it("normalizes legacy board statuses in task responses", async () => {
		invokeMock.mockResolvedValueOnce([
			{
				id: "T-1",
				initial_prompt: "Legacy task",
				status: "todo",
				prompt: null,
				agent: null,
				permission_mode: null,
				worktree_source: null,
				worktree_branch: null,
				depends_on: [],
				project_id: null,
				created_at: 1000,
				updated_at: 1000,
			},
		]);

		await expect(getAllTasks()).resolves.toEqual([
			expect.objectContaining({ id: "T-1", status: "backlog" }),
		]);
	});

  it("loads compact relationship references without full prompt fields", async () => {
    invokeMock.mockResolvedValueOnce([{
      id: "T-related",
      status: "in_progress",
      project_id: "P-2",
      title: "Compact relationship title",
      depends_on: ["T-active"],
    }])

    const references = await getTaskRelationshipReferences("P-1")

    expect(invokeMock).toHaveBeenLastCalledWith("get_task_relationship_references", { projectId: "P-1" })
    expect(references).toEqual([{
      id: "T-related",
      status: "doing",
      project_id: "P-2",
      title: "Compact relationship title",
      depends_on: ["T-active"],
    }])
    expect(references[0]).not.toHaveProperty("initial_prompt")
    expect(references[0]).not.toHaveProperty("prompt")
  })

	it("rejects unknown task statuses from the backend boundary", async () => {
		invokeMock.mockResolvedValueOnce([
			{
				id: "T-2",
				initial_prompt: "Broken task",
				status: "wat",
				prompt: null,
				agent: null,
				permission_mode: null,
				worktree_source: null,
				worktree_branch: null,
				depends_on: [],
				project_id: null,
				created_at: 1000,
				updated_at: 1000,
			},
		]);

		await expect(getAllTasks()).rejects.toThrow("Invalid board status: wat");
	});

	it("normalizes createTask responses before returning to the UI", async () => {
		invokeMock.mockResolvedValueOnce({
			id: "T-4",
			initial_prompt: "Created task",
			status: "testing",
			prompt: null,
			agent: null,
			permission_mode: null,
			worktree_source: null,
			worktree_branch: null,
			depends_on: [],
			project_id: null,
			created_at: 1000,
			updated_at: 1000,
		});

		await expect(
			createTask("Created task", "doing", null, null),
		).resolves.toEqual(expect.objectContaining({ id: "T-4", status: "doing" }));
		expect(invokeMock).toHaveBeenCalledWith("create_task", {
			initialPrompt: "Created task",
			status: "doing",
			projectId: null,
			permissionMode: null,
			dependsOn: [],
			labelNames: [],
			worktreeSource: null,
			worktreeBranch: null,
			title: null,
			sourceTicketUrl: null,
			taskDisplayTitleUpdatesEnabled: undefined,
			aiProvider: null,
		});
		expect(invokeMock.mock.calls[0]?.[1]).not.toHaveProperty("codeCleanupEnabled");
	});

	it("sends persisted worktree branch source when creating a task", async () => {
		invokeMock.mockResolvedValueOnce({
			id: "T-5",
			initial_prompt: "Continue PR",
			status: "backlog",
			prompt: null,
			agent: null,
			permission_mode: null,
			worktree_source: "existingBranch",
			worktree_branch: "feature/open-pr",
			depends_on: [],
			project_id: "P-1",
			created_at: 1000,
			updated_at: 1000,
		});

		await createTask("Continue PR", "backlog", "P-1", "default", {
			worktreeSource: "existingBranch",
			worktreeBranch: "feature/open-pr",
		});

		expect(invokeMock).toHaveBeenCalledWith("create_task", {
			initialPrompt: "Continue PR",
			status: "backlog",
			projectId: "P-1",
			permissionMode: "default",
			dependsOn: [],
			labelNames: [],
			worktreeSource: "existingBranch",
			worktreeBranch: "feature/open-pr",
			title: null,
			sourceTicketUrl: null,
			taskDisplayTitleUpdatesEnabled: undefined,
			aiProvider: null,
		});
	});

	it("sends disabled worktree source when creating a project-directory task", async () => {
		invokeMock.mockResolvedValueOnce({
			id: "T-6",
			initial_prompt: "Run without a worktree",
			status: "backlog",
			prompt: null,
			agent: null,
			permission_mode: null,
			worktree_source: "disabled",
			worktree_branch: null,
			depends_on: [],
			project_id: "P-1",
			created_at: 1000,
			updated_at: 1000,
		});

		await createTask("Run without a worktree", "backlog", "P-1", "default", {
			worktreeSource: "disabled",
			worktreeBranch: null,
		});

		expect(invokeMock).toHaveBeenCalledWith("create_task", {
			initialPrompt: "Run without a worktree",
			status: "backlog",
			projectId: "P-1",
			permissionMode: "default",
			dependsOn: [],
			labelNames: [],
			worktreeSource: "disabled",
			worktreeBranch: null,
			title: null,
			sourceTicketUrl: null,
			taskDisplayTitleUpdatesEnabled: undefined,
			aiProvider: null,
		});
	});

	it("requests git branches through the typed IPC wrapper", async () => {
		invokeMock.mockResolvedValueOnce([{ name: "feature/open-pr", is_current: false, is_remote: false }]);

		await expect(listGitBranches("/repo")).resolves.toEqual([
			{ name: "feature/open-pr", is_current: false, is_remote: false },
		]);

		expect(invokeMock).toHaveBeenCalledWith("list_git_branches", { repoPath: "/repo" });
	});

	it("checks whether a repo has commits through the typed IPC wrapper", async () => {
		invokeMock.mockResolvedValueOnce(false);

		await expect(repoHasCommits("/repo")).resolves.toBe(false);

		expect(invokeMock).toHaveBeenCalledWith("repo_has_commits", { repoPath: "/repo" });
	});

	it("sends task edits as initial prompt updates", async () => {
		await updateTaskInitialPrompt("T-42", "Updated prompt");

		expect(invokeMock).toHaveBeenCalledWith("update_task", {
			id: "T-42",
			initialPrompt: "Updated prompt",
		});
	});
	it("sends camelCase sourceTicketUrl when updating a task's source ticket link", async () => {
		await updateTaskSourceTicketUrl("T-42", "https://github.com/koenvg/openforge/issues/1294");

		expect(invokeMock).toHaveBeenCalledWith("update_task_source_ticket_url", {
			id: "T-42",
			sourceTicketUrl: "https://github.com/koenvg/openforge/issues/1294",
		});
	});

	it("sends a null sourceTicketUrl when clearing a task's source ticket link", async () => {
		await updateTaskSourceTicketUrl("T-42", null);

		expect(invokeMock).toHaveBeenCalledWith("update_task_source_ticket_url", {
			id: "T-42",
			sourceTicketUrl: null,
		});
	});

	it("preserves snake_case nested file payload keys for task batch contents", async () => {
		await getTaskBatchFileContents("T-42", [{ path: "src/App.svelte", oldPath: "src/Old.svelte", status: "renamed" }], false, true);

		expect(invokeMock).toHaveBeenCalledWith("get_task_batch_file_contents", {
			taskId: "T-42",
			files: [{ path: "src/App.svelte", old_path: "src/Old.svelte", status: "renamed" }],
			includeCommitted: false,
			includeUncommitted: true,
		});
	});

	it("preserves snake_case nested file payload keys for commit batch contents", async () => {
		await getCommitBatchFileContents("T-42", "abc123", [{ path: "src/App.svelte", oldPath: null, status: "added" }]);

		expect(invokeMock).toHaveBeenCalledWith("get_commit_batch_file_contents", {
			taskId: "T-42",
			commitSha: "abc123",
			files: [{ path: "src/App.svelte", old_path: null, status: "added" }],
		});
	});

	it("does not export removed live GitHub agent review controls", () => {
		expect(ipcModule).not.toHaveProperty("startAgentReview");
		expect(ipcModule).not.toHaveProperty("abortAgentReview");
		expect(ipcModule).not.toHaveProperty("dismissAllAgentReviewComments");
		expect(ipcModule).toHaveProperty("getAgentReviewComments");
		expect(ipcModule).toHaveProperty("updateAgentReviewCommentStatus");
		expect(ipcModule).not.toHaveProperty("resumeImplementation");
	});

	it("does not export plugin-owned PR walkthrough commands", () => {
		expect(ipcModule).not.toHaveProperty("getPrWalkthrough");
		expect(ipcModule).not.toHaveProperty("startAgentWalkthrough");
		expect(ipcModule).not.toHaveProperty("abortAgentWalkthrough");
		expect(ipcModule).not.toHaveProperty("deletePrWalkthrough");
	});

	it("sends registerBuiltinPlugin metadata as a single trusted builtin command argument", async () => {
		await registerBuiltinPlugin({
			id: "com.openforge.file-viewer",
			name: "File Viewer",
			version: "1.2.3",
			apiVersion: 1,
			description: "Built-in file viewer",
			permissions: "[]",
			contributes: "{}",
			frontendEntry: "./dist/frontend.js",
			backendEntry: null,
			installPath: "builtin:com.openforge.file-viewer",
			sourceKind: "builtin",
			sourceSpec: "com.openforge.file-viewer",
			packageMetadata: "{}",
			installedAt: 1234,
			isBuiltin: true,
		});

		expect(invokeMock).toHaveBeenCalledWith("register_builtin_plugin", {
			plugin: {
				id: "com.openforge.file-viewer",
				name: "File Viewer",
				version: "1.2.3",
				apiVersion: 1,
				description: "Built-in file viewer",
				permissions: "[]",
				contributes: "{}",
				frontendEntry: "./dist/frontend.js",
				backendEntry: null,
				installPath: "builtin:com.openforge.file-viewer",
				sourceKind: "builtin",
				sourceSpec: "com.openforge.file-viewer",
				packageMetadata: "{}",
				installedAt: 1234,
				isBuiltin: true,
			},
		});
	});

	it("routes package-source plugin installs through typed IPC payloads", async () => {
		invokeMock.mockResolvedValue({
			id: "com.example.plugin",
			name: "Example Plugin",
			version: "1.2.3",
			api_version: 1,
			description: "Adds examples",
			permissions: "[]",
			contributes: "{}",
			frontend_entry: "dist/frontend.js",
			backend_entry: null,
			install_path: "/plugins/example",
			source_kind: "npm",
			source_spec: "npm:@example/plugin@1.2.3",
			package_metadata: "{}",
			installed_at: 1234,
			is_builtin: false,
		});

		await expect(installPluginFromNpm("@example/plugin@1.2.3")).resolves.toMatchObject({
			id: "com.example.plugin",
			sourceKind: "npm",
			sourceSpec: "npm:@example/plugin@1.2.3",
		});
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_npm", { packageName: "@example/plugin@1.2.3" });

		await installPluginFromGit("github.com/example/openforge-plugin@main");
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_git", { gitSpec: "github.com/example/openforge-plugin@main" });

		await installPluginFromLocal("/Users/me/plugin");
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_local", { sourcePath: "/Users/me/plugin" });

		await installPluginFromSource("git:github.com/example/openforge-plugin@main");
		expect(invokeMock).toHaveBeenLastCalledWith("install_plugin_from_source", { sourceSpec: "git:github.com/example/openforge-plugin@main" });
	});

	it("scans a plugin folder through the sidecar", async () => {
		invokeMock.mockResolvedValueOnce([]);

		await scanPluginFolder("/Users/me/repos/openforge-plugins");

		expect(invokeMock).toHaveBeenLastCalledWith("scan_plugin_folder", {
			folderPath: "/Users/me/repos/openforge-plugins",
		});
	});

	it("encodes voice audio as base64 little-endian Float32 PCM instead of a JSON number array", async () => {
		await transcribeAudio(new Float32Array([0, 0.25, -0.25]));

		expect(invokeMock).toHaveBeenCalledWith("transcribe_audio", {
			audioPcmBase64: "AAAAAAAAgD4AAIC+",
		});
	});
});

describe("ipc checkPiInstalled", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue({
			installed: true,
			path: "/usr/local/bin/pi",
			version: "1.2.3",
		});
	});

	it("calls check_pi_installed", async () => {
		await checkPiInstalled();

		expect(invokeMock).toHaveBeenCalledWith("check_pi_installed");
	});

	it("returns the installed/path/version shape", async () => {
		await expect(checkPiInstalled()).resolves.toEqual({
			installed: true,
			path: "/usr/local/bin/pi",
			version: "1.2.3",
		});
	});
});

describe("ipc checkCodexInstalled", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue({
			installed: true,
			path: "/usr/local/bin/codex",
			version: "codex-cli 0.137.0",
		});
	});

	it("calls check_codex_installed", async () => {
		await checkCodexInstalled();

		expect(invokeMock).toHaveBeenCalledWith("check_codex_installed");
	});

	it("returns the installed/path/version shape", async () => {
		await expect(checkCodexInstalled()).resolves.toEqual({
			installed: true,
			path: "/usr/local/bin/codex",
			version: "codex-cli 0.137.0",
		});
	});
});

describe("ipc fsWriteFile", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(undefined);
	});

	it("calls fs_write_file with the project-relative path and content", async () => {
		await fsWriteFile("P-1", "generated/report.md", "# Report\n");

		expect(invokeMock).toHaveBeenCalledWith("fs_write_file", {
			projectId: "P-1",
			filePath: "generated/report.md",
			content: "# Report\n",
		});
	});
});

describe("ipc fsSearchFiles", () => {
	beforeEach(() => {
		invokeMock.mockReset();
		invokeMock.mockResolvedValue(["src/lib/ipc.ts", "src/lib/types.ts"]);
	});

	it("calls fs_search_files with correct payload including limit", async () => {
		await fsSearchFiles("P-1", "ipc", 30);
		expect(invokeMock).toHaveBeenCalledWith("fs_search_files", {
			projectId: "P-1",
			query: "ipc",
			limit: 30,
		});
	});

	it("defaults limit to 50 when not specified", async () => {
		await fsSearchFiles("P-1", "foo");
		expect(invokeMock).toHaveBeenCalledWith("fs_search_files", {
			projectId: "P-1",
			query: "foo",
			limit: 50,
		});
	});

	it("returns string array from invoke", async () => {
		const result = await fsSearchFiles("P-1", "test");
		expect(result).toEqual(["src/lib/ipc.ts", "src/lib/types.ts"]);
	});
});
