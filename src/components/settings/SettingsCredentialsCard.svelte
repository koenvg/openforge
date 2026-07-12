<script lang="ts">
	import { KeyRound, GitBranch } from '@lucide/svelte';
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
