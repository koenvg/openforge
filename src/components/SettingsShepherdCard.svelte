<script lang="ts">
	import { FlaskConical } from 'lucide-svelte'

	interface Props {
		shepherdEnabled: boolean
		onShepherdToggle: () => void
	}

	const { shepherdEnabled, onShepherdToggle }: Props = $props()
</script>

<div id="section-shepherd" class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
	<div class="flex items-center gap-2 px-5 py-3 border-b border-base-300">
		<FlaskConical size={16} />
		<h3 class="text-sm font-semibold text-base-content m-0">Task Shepherd</h3>
		<span class="badge badge-warning badge-sm">Experimental</span>
	</div>

	<div class="p-5">
		<div class="flex flex-col gap-4">
			<label class="flex items-center justify-between cursor-pointer">
				<div class="flex flex-col gap-0.5">
					<span class="text-sm text-base-content">Enable Task Shepherd</span>
					<span class="text-[0.7rem] text-base-content/50">An AI agent will monitor task events and advise you on what to focus on.</span>
				</div>
				<input
					type="checkbox"
					class="toggle toggle-primary toggle-sm"
					checked={shepherdEnabled}
					onchange={onShepherdToggle}
					data-testid="shepherd-toggle"
				/>
			</label>
		</div>
	</div>
</div>
