<script lang="ts">
	import { KeyRound, GitBranch, Sparkles } from '@lucide/svelte';

	interface Props {
		githubToken: string;
		onGithubTokenChange: (value: string) => void;
		anthropicApiKey: string;
		onAnthropicApiKeyChange: (value: string) => void;
		disabled: boolean;
	}

	const {
		githubToken,
		onGithubTokenChange,
		anthropicApiKey,
		onAnthropicApiKeyChange,
		disabled
	}: Props = $props();
</script>

<div id="section-credentials" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
	<div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
		<KeyRound size={16} />
		<h3 class="text-sm font-semibold text-base-content m-0">Credentials</h3>
	</div>

	<div class="p-5">
		<div class="grid grid-cols-1 gap-6">
			<!-- GitHub Column -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<GitBranch size={14} />
					<span class="text-xs font-semibold text-base-content uppercase tracking-wider">GitHub</span>
				</div>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">Personal Access Token</span>
					<input
						type="password"
						value={githubToken}
						oninput={(e) => onGithubTokenChange(e.currentTarget.value)}
						placeholder="ghp_..."
						disabled={disabled}
						class="input input-bordered input-sm w-full"
					/>
				</label>
			</div>

			<!-- Anthropic Column -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<Sparkles size={14} />
					<span class="text-xs font-semibold text-base-content uppercase tracking-wider">Anthropic</span>
				</div>

				<label class="flex flex-col gap-1">
					<span class="text-[0.7rem] text-base-content/50">Cloud API Key</span>
					<input
						type="password"
						value={anthropicApiKey}
						oninput={(e) => onAnthropicApiKeyChange(e.currentTarget.value)}
						placeholder="sk-ant-..."
						disabled={disabled}
						class="input input-bordered input-sm w-full"
					/>
					<span class="text-[0.7rem] text-base-content/40">Enables cloud AI features such as roadmap Refine.</span>
				</label>
			</div>
		</div>
	</div>
</div>
