<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
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
		<Panel padding="none" variant="subtle">
		  <div class="settings-layout flex min-h-14 items-center gap-3 px-4 py-3" role="status">
			{#if githubToken.trim()}
				<CheckCircle2 size={18} class="shrink-0 text-[var(--of-success)]" aria-hidden="true" />
				<div>
					<p class="m-0 text-sm font-medium text-[var(--of-text)]">GitHub credential configured</p>
					<p class="m-0 mt-0.5 text-xs text-[var(--of-text-muted)]">Connectivity is verified during GitHub Sync.</p>
				</div>
			{:else}
				<AlertCircle size={18} class="shrink-0 text-[var(--of-warning)]" aria-hidden="true" />
				<div>
					<p class="m-0 text-sm font-medium text-[var(--of-text)]">GitHub credential not configured</p>
					<p class="m-0 mt-0.5 text-xs text-[var(--of-text-muted)]">Add a personal access token to enable authenticated GitHub Sync.</p>
				</div>
			{/if}
		</div>
		</Panel>

			<!-- GitHub Column -->
			<div class="flex flex-col gap-4">
				<div class="flex items-center gap-2">
					<GitBranch size={14} />
					<span class="text-xs font-semibold text-[var(--of-text)] uppercase tracking-wider">GitHub</span>
				</div>

				<div class="flex flex-col gap-1">
					<TextField label="Personal Access Token"
						type="password"
						value={githubToken}
						oninput={(e) => onGithubTokenChange(e.currentTarget.value)}
						placeholder="ghp_..."
						disabled={disabled}
						class="w-full"
					/>
				</div>
			</div>
	</div>
</SettingsSectionCard>
