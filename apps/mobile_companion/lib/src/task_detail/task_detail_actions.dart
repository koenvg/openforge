part of 'task_detail_screen.dart';

class _CompleteTaskAction extends StatelessWidget {
  const _CompleteTaskAction({
    required this.detail,
    required this.pending,
    required this.error,
    required this.onPressed,
  });

  final TaskDetail detail;
  final bool pending;
  final String? error;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) => Material(
    elevation: 4,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: <Widget>[
          if (error case final message?) ...<Widget>[
            Semantics(
              container: true,
              liveRegion: true,
              label: message,
              child: ExcludeSemantics(
                child: Text(
                  message,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
            ),
            const SizedBox(height: 12),
          ],
          Semantics(
            button: true,
            enabled: !pending,
            label: pending
                ? 'Completing ${detail.title}'
                : 'Complete ${detail.title}',
            child: FilledButton.icon(
              onPressed: pending ? null : onPressed,
              style: FilledButton.styleFrom(
                backgroundColor: Theme.of(context).colorScheme.error,
                foregroundColor: Theme.of(context).colorScheme.onError,
                minimumSize: const Size.fromHeight(48),
              ),
              icon: pending
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.flag_outlined),
              label: Text(pending ? 'Completing…' : 'Complete'),
            ),
          ),
        ],
      ),
    ),
  );
}

class _TaskStartAction extends StatelessWidget {
  const _TaskStartAction({required this.state, required this.onStart});

  final TaskStartActionState state;
  final Future<void> Function() onStart;

  @override
  Widget build(BuildContext context) {
    final pending = state is TaskStartPending;
    final refreshRequired = switch (state) {
      TaskStartUncertain(:final authorityRefreshed) => !authorityRefreshed,
      _ => false,
    };
    final disabled = pending || refreshRequired;
    final message = state.message;
    final messageLabel = switch (state) {
      TaskStartDesktopActionRequired() => 'Desktop action required',
      TaskStartUncertain() => 'Start result uncertain',
      TaskStartFailed() => 'Task Start failed',
      _ => null,
    };

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Semantics(
          button: true,
          enabled: !disabled,
          liveRegion: pending,
          label: pending
              ? 'Starting Task'
              : refreshRequired
              ? 'Authoritative refresh required before retry'
              : 'Start Task',
          child: ExcludeSemantics(
            child: FilledButton.icon(
              style: FilledButton.styleFrom(
                minimumSize: const Size.fromHeight(48),
              ),
              onPressed: disabled ? null : () => unawaited(onStart()),
              icon: pending
                  ? const SizedBox.square(
                      dimension: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(
                      refreshRequired
                          ? Icons.sync_problem_rounded
                          : Icons.play_arrow_rounded,
                    ),
              label: Text(
                pending
                    ? 'Starting…'
                    : refreshRequired
                    ? 'Refresh required'
                    : 'Start',
              ),
            ),
          ),
        ),
        if (messageLabel != null && message.isNotEmpty) ...<Widget>[
          const SizedBox(height: 12),
          Semantics(
            container: true,
            liveRegion: true,
            label: messageLabel,
            child: ExcludeSemantics(
              child: Material(
                color: Theme.of(context).colorScheme.surfaceContainerHighest,
                borderRadius: BorderRadius.circular(12),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const Icon(Icons.info_outline_rounded),
                      const SizedBox(width: 12),
                      Expanded(child: Text(message)),
                    ],
                  ),
                ),
              ),
            ),
          ),
        ],
      ],
    );
  }
}
