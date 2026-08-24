<script lang="ts">
  import SdkMarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import { openUrl } from '../../../lib/ipc'
  import type { ResolvedMarkdownMedia } from '../../../lib/markdown'

  interface Props {
    content: string
    imageBaseUrl?: string | null
    /** Exchange an upload URL for one this app can render (see ipc.resolveGithubAsset). */
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
  }

  let { content, imageBaseUrl = null, resolveRemoteMedia }: Props = $props()
</script>

<SdkMarkdownContent {content} {imageBaseUrl} {resolveRemoteMedia} onOpenUrl={openUrl} />
