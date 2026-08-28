import { describe, expect, it } from 'vitest'
import { resolveWalkthroughGuidance } from './walkthroughGuidance'
import { DEFAULT_REVIEW_GUIDANCE, DEFAULT_WALKTHROUGH_GUIDANCE } from './walkthroughPrompt'

type Api = Parameters<typeof resolveWalkthroughGuidance>[0]

function makeApi(
  global: Record<string, string | null> = {},
  project: Record<string, string | null> = {},
): Api {
  return {
    config: { get: async (key: string) => global[key] ?? null },
    projectConfig: { get: async (key: string) => project[key] ?? null },
  } as unknown as Api
}

describe('resolveWalkthroughGuidance', () => {
  it('falls back to the shipped defaults when nothing is configured', async () => {
    const guidance = await resolveWalkthroughGuidance(makeApi(), 'proj-1')

    expect(guidance.reviewGuidance).toBe(DEFAULT_REVIEW_GUIDANCE)
    expect(guidance.walkthroughGuidance).toBe(DEFAULT_WALKTHROUGH_GUIDANCE)
  })

  it('prefers a global value over the default', async () => {
    const guidance = await resolveWalkthroughGuidance(
      makeApi({ pr_review_guidance: 'Be strict.', pr_walkthrough_guidance: 'Tests last.' }),
      null,
    )

    expect(guidance.reviewGuidance).toBe('Be strict.')
    expect(guidance.walkthroughGuidance).toBe('Tests last.')
  })

  it('prefers a project override over the global value', async () => {
    const guidance = await resolveWalkthroughGuidance(
      makeApi(
        { pr_review_guidance: 'Global.', pr_walkthrough_guidance: 'Global.' },
        { pr_review_guidance: 'Project.', pr_walkthrough_guidance: 'Project steps.' },
      ),
      'proj-1',
    )

    expect(guidance.reviewGuidance).toBe('Project.')
    expect(guidance.walkthroughGuidance).toBe('Project steps.')
  })

  it('ignores project overrides when there is no active project', async () => {
    const guidance = await resolveWalkthroughGuidance(
      makeApi({ pr_review_guidance: 'Global.' }, { pr_review_guidance: 'Project.' }),
      null,
    )

    expect(guidance.reviewGuidance).toBe('Global.')
  })

  // These settings ship with real content, so an empty value is the user saying
  // "no extra guidance" — restoring the default here would make the field
  // impossible to clear.
  it('treats a cleared value as deliberate rather than unset', async () => {
    const guidance = await resolveWalkthroughGuidance(
      makeApi({ pr_review_guidance: '', pr_walkthrough_guidance: '' }),
      null,
    )

    expect(guidance.reviewGuidance).toBe('')
    expect(guidance.walkthroughGuidance).toBe('')
  })

  it('lets a project clear guidance that global sets', async () => {
    const guidance = await resolveWalkthroughGuidance(
      makeApi({ pr_review_guidance: 'Global.' }, { pr_review_guidance: '' }),
      'proj-1',
    )

    expect(guidance.reviewGuidance).toBe('')
  })

  it('resolves the two settings independently', async () => {
    const guidance = await resolveWalkthroughGuidance(
      makeApi({ pr_review_guidance: 'Only review configured.' }),
      null,
    )

    expect(guidance.reviewGuidance).toBe('Only review configured.')
    expect(guidance.walkthroughGuidance).toBe(DEFAULT_WALKTHROUGH_GUIDANCE)
  })
})
