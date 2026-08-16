<script lang="ts">
	import { AlertCircle, CheckCircle2, GitBranch, KeyRound } from '@lucide/svelte';
	import SettingsSectionCard from './SettingsSectionCard.svelte';

	interface Props {
		githubToken: string;
		onGithubTokenChange: (value: string) => void;
		disabled: boolean;
	}

	const {
		githubToken,
		onGithubTokenChange,
		disabled
	}: Props = $props();
</script>

<SettingsSectionCard id="section-credentials" title="Credentials" {disabled}>
	{#snippet icon()}<KeyRound size={16} />{/snippet}
	<div class="grid grid-cols-1 gap-6">
		<div class="flex min-h-14 items-center gap-3 rounded-lg border border-base-300 bg-base-200/45 px-4 py-3" role="status">
			{#if githubToken.trim()}
				<CheckCircle2 size={18} class="shrink-0 text-success" aria-hidden="true" />
				<div>
					<p class="m-0 text-sm font-medium text-base-content">GitHub credential configured</p>
					<p class="m-0 mt-0.5 text-xs text-base-content/60">Connectivity is verified during GitHub Sync.</p>
				</div>
			{:else}
				<AlertCircle size={18} class="shrink-0 text-warning" aria-hidden="true" />
				<div>
					<p class="m-0 text-sm font-medium text-base-content">GitHub credential not configured</p>
					<p class="m-0 mt-0.5 text-xs text-base-content/60">Add a personal access token to enable authenticated GitHub Sync.</p>
				</div>
			{/if}
		</div>

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
	</div>
</SettingsSectionCard>
