export function shouldRunMarkdownVisuals(
  environment: { RUN_MARKDOWN_VISUALS?: string } = process.env,
  _platform: NodeJS.Platform = process.platform,
): boolean {
  return environment.RUN_MARKDOWN_VISUALS === '1'
}
