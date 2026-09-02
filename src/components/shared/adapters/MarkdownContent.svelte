<script lang="ts">
  import SdkMarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import type { MarkdownRepositoryLinkTarget } from '@openforge-app/plugin-sdk/markdown'
  import { openUrl } from '../../../lib/ipc'
  import { selectedTheme } from '../../../lib/theme'
  import type { ResolvedMarkdownMedia } from '../../../lib/markdown'

  interface Props {
    content: string
    imageBaseUrl?: string | null
    markdownFilePath?: string | null
    resolveRepositoryImage?: (repositoryPath: string) => Promise<string | null>
    onOpenRepositoryPath?: (target: MarkdownRepositoryLinkTarget) => void | Promise<void>
    /** Exchange an upload URL for one this app can render (see ipc.resolveGithubAsset). */
    resolveRemoteMedia?: (url: string) => Promise<ResolvedMarkdownMedia | null>
  }

  let {
    content,
    imageBaseUrl = null,
    markdownFilePath = null,
    resolveRepositoryImage,
    resolveRemoteMedia,
    onOpenRepositoryPath,
  }: Props = $props()
</script>

<SdkMarkdownContent
  {content}
  appearance={$selectedTheme.appearance}
  {imageBaseUrl}
  {markdownFilePath}
  {resolveRepositoryImage}
  {resolveRemoteMedia}
  {onOpenRepositoryPath}
  onOpenUrl={openUrl}
/>
