export interface CommentAddressingState {
  isAddressing(commentId: number): boolean
  errorFor(commentId: number): string | null
  run(commentId: number, action: () => Promise<void> | void): Promise<boolean>
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Unknown error'
}

export function createCommentAddressing(): CommentAddressingState {
  let addressingCommentIds = $state<Set<number>>(new Set())
  let errorsByCommentId = $state<Map<number, string>>(new Map())

  function setAddressing(commentId: number, addressing: boolean): void {
    const next = new Set(addressingCommentIds)
    if (addressing) next.add(commentId)
    else next.delete(commentId)
    addressingCommentIds = next
  }

  function setError(commentId: number, message: string | null): void {
    const next = new Map(errorsByCommentId)
    if (message) next.set(commentId, message)
    else next.delete(commentId)
    errorsByCommentId = next
  }

  async function run(commentId: number, action: () => Promise<void> | void): Promise<boolean> {
    if (addressingCommentIds.has(commentId)) return false

    setAddressing(commentId, true)
    setError(commentId, null)
    try {
      await action()
      return true
    } catch (error) {
      console.error(`Failed to mark comment ${commentId} addressed:`, error)
      setError(commentId, `Could not mark comment addressed: ${errorMessage(error)}`)
      return false
    } finally {
      setAddressing(commentId, false)
    }
  }

  return {
    isAddressing: (commentId) => addressingCommentIds.has(commentId),
    errorFor: (commentId) => errorsByCommentId.get(commentId) ?? null,
    run,
  }
}
