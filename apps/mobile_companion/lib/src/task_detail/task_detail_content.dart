part of 'task_detail_screen.dart';

class _TaskDetailBody extends StatelessWidget {
  const _TaskDetailBody({
    required this.state,
    required this.onRefresh,
    required this.onOpenTask,
    required this.deleteBusy,
    required this.deleteAvailable,
    required this.onDelete,
    required this.startAction,
    required this.onStart,
  });

  final TaskDetailViewState state;
  final Future<void> Function() onRefresh;
  final void Function(String taskId)? onOpenTask;
  final bool deleteBusy;
  final bool deleteAvailable;
  final Future<void> Function(TaskDetail detail) onDelete;
  final TaskStartActionState startAction;
  final Future<void> Function()? onStart;

  @override
  Widget build(BuildContext context) => switch (state) {
    TaskDetailLoading() => Center(
      child: Semantics(
        liveRegion: true,
        label: 'Loading Task detail',
        child: const CircularProgressIndicator(),
      ),
    ),
    TaskDetailLoaded(:final detail, :final deletePhase, :final deleteMessage) =>
      _LoadedTaskDetail(
        detail: detail,
        onOpenTask: onOpenTask,
        deletePending: deleteBusy || deletePhase == TaskDeletePhase.pending,
        deleteMessage: deleteMessage,
        deleteAvailable: deleteAvailable,
        onDelete: onDelete,
        startAction: startAction,
        onStart: onStart,
      ),
    TaskDetailNotFound() => const _DetailState(
      icon: Icons.task_alt_outlined,
      title: 'Task no longer available',
      message: 'This Task may have been Completed or deleted on the desktop.',
    ),
    TaskDetailAuthorizationRequired() => const _DetailState(
      icon: Icons.phonelink_lock_outlined,
      title: 'Re-pair required',
      message: 'Pair this phone again to view current Task detail.',
    ),
    TaskDetailIncompatible() => const _DetailState(
      icon: Icons.system_update_outlined,
      title: 'Update required',
      message: 'Update OpenForge Companion to read this desktop protocol.',
    ),
    TaskDetailUnavailable() => _DetailState(
      icon: Icons.cloud_off_outlined,
      title: 'Task detail unavailable',
      message: 'Check the desktop connection and try again.',
      onRetry: onRefresh,
    ),
  };
}

class _LoadedTaskDetail extends StatelessWidget {
  const _LoadedTaskDetail({
    required this.detail,
    required this.onOpenTask,
    required this.deletePending,
    required this.deleteMessage,
    required this.deleteAvailable,
    required this.onDelete,
    required this.startAction,
    required this.onStart,
  });

  final TaskDetail detail;
  final void Function(String taskId)? onOpenTask;
  final bool deletePending;
  final String? deleteMessage;
  final bool deleteAvailable;
  final Future<void> Function(TaskDetail detail) onDelete;
  final TaskStartActionState startAction;
  final Future<void> Function()? onStart;

  @override
  Widget build(BuildContext context) {
    final boardStatus = _boardStatusLabel(detail.boardStatus);
    final agentState = _agentStateLabel(detail.agentState);
    final handoffNotes = detail.handoffNotes?.trim();
    final visibleHandoff = handoffNotes == null || handoffNotes.isEmpty
        ? 'No Handoff Notes yet.'
        : handoffNotes;

    return Semantics(
      container: true,
      explicitChildNodes: true,
      label:
          'Task ${detail.title}. Project ${detail.projectName}. Board Status $boardStatus. Agent $agentState.',
      child: ListView(
        key: const PageStorageKey<String>('task-detail-scroll'),
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
        children: <Widget>[
          Text(detail.title, style: Theme.of(context).textTheme.headlineSmall),
          if (detail.boardStatus == 'backlog' && onStart != null) ...<Widget>[
            const SizedBox(height: 16),
            _TaskStartAction(state: startAction, onStart: onStart!),
          ],
          const SizedBox(height: 20),
          _DetailCard(
            children: <Widget>[
              _LabeledValue(label: 'Project', value: detail.projectName),
              const Divider(height: 24),
              _LabeledValue(label: 'Board Status', value: boardStatus),
            ],
          ),
          if (detail.labels.isNotEmpty) ...<Widget>[
            const SizedBox(height: 16),
            _TaskLabelsCard(labels: detail.labels),
          ],
          if (detail.dependencies.isNotEmpty) ...<Widget>[
            const SizedBox(height: 16),
            _TaskRelationshipsCard.dependencies(
              relationships: detail.dependencies,
              onOpenTask: onOpenTask,
            ),
          ],
          if (detail.dependentTasks.isNotEmpty) ...<Widget>[
            const SizedBox(height: 16),
            _TaskRelationshipsCard.dependents(
              relationships: detail.dependentTasks,
              onOpenTask: onOpenTask,
            ),
          ],
          const SizedBox(height: 16),
          _MarkdownDetailCard(
            label: 'Initial Prompt',
            data: detail.initialPrompt,
          ),
          const SizedBox(height: 16),
          _MarkdownDetailCard(label: 'Handoff Notes', data: visibleHandoff),
          const SizedBox(height: 16),
          Semantics(
            container: true,
            label: detail.agentErrorSummary == null
                ? 'Agent state. $agentState.'
                : 'Agent state. $agentState. ${detail.agentErrorSummary}',
            child: ExcludeSemantics(
              child: _DetailCard(
                children: <Widget>[
                  Text('Agent', style: Theme.of(context).textTheme.titleMedium),
                  const SizedBox(height: 8),
                  Text(agentState),
                  if (detail.agentErrorSummary case final error?) ...<Widget>[
                    const SizedBox(height: 8),
                    Text(error),
                  ],
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          _DetailCard(
            children: <Widget>[
              _LabeledValue(
                label: 'Created',
                value: _timestampLabel(context, detail.createdAt),
              ),
              const Divider(height: 24),
              _LabeledValue(
                label: 'Task updated',
                value: _timestampLabel(context, detail.updatedAt),
              ),
              if (detail.agentUpdatedAt case final updatedAt?) ...<Widget>[
                const Divider(height: 24),
                _LabeledValue(
                  label: 'Agent updated',
                  value: _timestampLabel(context, updatedAt),
                ),
              ],
            ],
          ),
          if (deleteMessage case final message?) ...<Widget>[
            const SizedBox(height: 16),
            Semantics(
              liveRegion: true,
              label: message,
              child: Text(
                message,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ],
          if (deleteAvailable && detail.boardStatus == 'backlog') ...<Widget>[
            const SizedBox(height: 24),
            Semantics(
              liveRegion: deletePending,
              label: deletePending
                  ? 'Deleting Task ${detail.title}'
                  : 'Delete Task ${detail.title}',
              button: true,
              enabled: !deletePending,
              child: ExcludeSemantics(
                child: OutlinedButton.icon(
                  style: OutlinedButton.styleFrom(
                    foregroundColor: Theme.of(context).colorScheme.error,
                    side: BorderSide(
                      color: Theme.of(context).colorScheme.error,
                    ),
                  ),
                  onPressed: deletePending ? null : () => onDelete(detail),
                  icon: deletePending
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.delete_outline),
                  label: Text(deletePending ? 'Deleting…' : 'Delete Task'),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _DetailCard extends StatelessWidget {
  const _DetailCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) => Card(
    margin: EdgeInsets.zero,
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: children,
      ),
    ),
  );
}

class _MarkdownDetailCard extends StatelessWidget {
  const _MarkdownDetailCard({required this.label, required this.data});

  final String label;
  final String data;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    explicitChildNodes: true,
    label: label,
    child: _DetailCard(
      children: <Widget>[
        ExcludeSemantics(
          child: Text(label, style: Theme.of(context).textTheme.titleMedium),
        ),
        const SizedBox(height: 8),
        SelectionArea(
          child: MarkdownBody(
            data: data,
            builders: <String, MarkdownElementBuilder>{
              'a': _SafeMarkdownLinkBuilder(),
            },
            imageBuilder: _buildSafeMarkdownImagePlaceholder,
          ),
        ),
      ],
    ),
  );
}

class _LabeledValue extends StatelessWidget {
  const _LabeledValue({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: <Widget>[
      Text(label, style: Theme.of(context).textTheme.labelLarge),
      const SizedBox(height: 4),
      Text(value),
    ],
  );
}

class _DetailState extends StatelessWidget {
  const _DetailState({
    required this.icon,
    required this.title,
    required this.message,
    this.onRetry,
  });

  final IconData icon;
  final String title;
  final String message;
  final Future<void> Function()? onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Semantics(
        container: true,
        liveRegion: true,
        label: title,
        child: ExcludeSemantics(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(
                icon,
                size: 64,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 24),
              Text(
                title,
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(message, textAlign: TextAlign.center),
              if (onRetry case final retry?) ...<Widget>[
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: () => retry(),
                  icon: const Icon(Icons.refresh),
                  label: const Text('Try again'),
                ),
              ],
            ],
          ),
        ),
      ),
    ),
  );
}

final class _SafeMarkdownLinkBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    markdown.Element element,
    TextStyle? _,
    TextStyle? parentStyle,
  ) {
    final styleSheet = MarkdownStyleSheet.fromTheme(Theme.of(context));
    final children = _buildSafeMarkdownLinkSpans(element.children, styleSheet);
    final destination = element.attributes['href']?.trim();
    if (destination != null &&
        destination.isNotEmpty &&
        element.textContent.trim() != destination) {
      children.add(TextSpan(text: ' ($destination)'));
    }

    return Semantics(
      child: Text.rich(TextSpan(style: parentStyle, children: children)),
    );
  }
}

List<InlineSpan> _buildSafeMarkdownLinkSpans(
  List<markdown.Node>? nodes,
  MarkdownStyleSheet styleSheet,
) => <InlineSpan>[
  for (final node in nodes ?? const <markdown.Node>[])
    _buildSafeMarkdownLinkSpan(node, styleSheet),
];

InlineSpan _buildSafeMarkdownLinkSpan(
  markdown.Node node,
  MarkdownStyleSheet styleSheet,
) {
  if (node is! markdown.Element) return TextSpan(text: node.textContent);
  if (node.tag == 'br') return const TextSpan(text: '\n');
  if (node.tag == 'img') {
    return WidgetSpan(
      alignment: PlaceholderAlignment.middle,
      child: _buildSafeMarkdownImagePlaceholder(
        Uri.tryParse(node.attributes['src'] ?? '') ?? Uri(),
        node.attributes['title'],
        node.attributes['alt'],
      ),
    );
  }

  final children = _buildSafeMarkdownLinkSpans(node.children, styleSheet);
  final childText = children.map((span) => span.toPlainText()).join();
  final useTextFallback =
      node.textContent.isNotEmpty && childText != node.textContent;
  return TextSpan(
    text: useTextFallback ? node.textContent : null,
    style: styleSheet.styles[node.tag],
    children: useTextFallback ? null : children,
  );
}

Widget _buildSafeMarkdownImagePlaceholder(Uri _, String? title, String? alt) {
  final description = switch ((alt?.trim(), title?.trim())) {
    (final altText?, _) when altText.isNotEmpty => altText,
    (_, final titleText?) when titleText.isNotEmpty => titleText,
    _ => null,
  };

  return Text(
    description == null ? '[Image omitted]' : '[Image: $description]',
  );
}

String _boardStatusLabel(String status) => switch (status) {
  'backlog' => 'Backlog',
  'doing' => 'Doing',
  'done' => 'Done',
  _ => status,
};

String _agentStateLabel(String state) => switch (state) {
  'waiting' => 'Waiting',
  'running' => 'Running',
  'blocked' => 'Needs input',
  'failed' => 'Failed',
  'complete' => 'Complete',
  _ => state,
};

String _timestampLabel(BuildContext context, DateTime timestamp) {
  final local = timestamp.toLocal();
  final localizations = MaterialLocalizations.of(context);
  final date = localizations.formatMediumDate(local);
  final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(local));
  return '$date · $time';
}
