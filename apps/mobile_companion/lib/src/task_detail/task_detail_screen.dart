import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as markdown;

import '../generated/companion_v1_client.dart';
import '../terminal/agent_terminal_pane.dart';
import '../terminal/agent_terminal_surface.dart';
import 'task_detail_controller.dart';

class TaskDetailScreen extends StatefulWidget {
  const TaskDetailScreen({
    required this.controller,
    this.terminalSurface,
    this.onRefresh,
    this.onCompleted,
    this.onDeleteSucceeded,
    this.onDeleteNeedsRefresh,
    super.key,
  });

  final TaskDetailController controller;
  final AgentTerminalSurface? terminalSurface;
  final Future<void> Function()? onRefresh;
  final Future<void> Function()? onCompleted;
  final Future<void> Function()? onDeleteSucceeded;
  final Future<void> Function()? onDeleteNeedsRefresh;

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  late TaskDetailViewState _state;
  late TaskStartActionState _startAction;

  @override
  void initState() {
    super.initState();
    _state = widget.controller.state;
    _startAction = widget.controller.startAction;
    widget.controller.addListener(_onControllerChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(widget.controller.refresh());
    });
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    widget.controller.dispose();
    widget.terminalSurface?.dispose();
    super.dispose();
  }

  void _onControllerChanged() {
    if (!mounted) return;
    setState(() {
      _state = widget.controller.state;
      _startAction = widget.controller.startAction;
    });
  }

  Future<void> _refresh() =>
      widget.onRefresh?.call() ?? widget.controller.refresh();

  @override
  Widget build(BuildContext context) => TaskDetailView(
    state: _state,
    onRefresh: _refresh,
    onComplete: widget.controller.completeAvailable
        ? widget.controller.complete
        : null,
    onCompleted: widget.onCompleted,
    onDelete: widget.controller.deleteBacklogTask,
    onDeleteSucceeded: widget.onDeleteSucceeded,
    onDeleteNeedsRefresh: widget.onDeleteNeedsRefresh,
    completePending: widget.controller.completePending,
    completeError: widget.controller.completeError,
    startAction: _startAction,
    onStart: widget.controller.start,
    terminalSurface: widget.terminalSurface,
  );
}

class TaskDetailView extends StatefulWidget {
  const TaskDetailView({
    required this.state,
    required this.onRefresh,
    this.onComplete,
    this.onCompleted,
    this.onDelete,
    this.onDeleteSucceeded,
    this.onDeleteNeedsRefresh,
    this.completePending = false,
    this.completeError,
    this.startAction = const TaskStartIdle(),
    this.onStart,
    this.terminalSurface,
    super.key,
  });

  final TaskDetailViewState state;
  final Future<void> Function() onRefresh;
  final Future<TaskCompleteAttempt> Function()? onComplete;
  final Future<void> Function()? onCompleted;
  final Future<TaskDeleteResult> Function()? onDelete;
  final Future<void> Function()? onDeleteSucceeded;
  final Future<void> Function()? onDeleteNeedsRefresh;
  final bool completePending;
  final String? completeError;
  final TaskStartActionState startAction;
  final Future<void> Function()? onStart;
  final AgentTerminalSurface? terminalSurface;

  @override
  State<TaskDetailView> createState() => _TaskDetailViewState();
}

class _TaskDetailViewState extends State<TaskDetailView>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final TabController _tabs;
  late bool _foreground;
  var _selectedTab = 0;
  var _completionAccepted = false;
  var _deleteBusy = false;

  @override
  void initState() {
    super.initState();
    final lifecycleState = WidgetsBinding.instance.lifecycleState;
    _foreground =
        lifecycleState == null || lifecycleState == AppLifecycleState.resumed;
    WidgetsBinding.instance.addObserver(this);
    _tabs = TabController(length: 2, vsync: this)..addListener(_onTabChanged);
    widget.terminalSurface?.presentation.setForeground(_foreground);
    _syncAvailability();
  }

  @override
  void didUpdateWidget(covariant TaskDetailView oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.terminalSurface != widget.terminalSurface) {
      oldWidget.terminalSurface?.presentation.setVisible(false);
      widget.terminalSurface?.presentation
        ?..setForeground(_foreground)
        ..setVisible(_selectedTab == 1);
    }
    _syncAvailability();
  }

  @override
  void dispose() {
    widget.terminalSurface?.presentation.setVisible(false);
    WidgetsBinding.instance.removeObserver(this);
    _tabs
      ..removeListener(_onTabChanged)
      ..dispose();
    super.dispose();
  }

  void _syncAvailability() {
    final available = switch (widget.state) {
      TaskDetailLoaded(:final detail) => detail.agentTerminalAvailable,
      _ => false,
    };
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) {
        widget.terminalSurface?.presentation.updateAvailability(available);
      }
    });
  }

  void _onTabChanged() {
    if (_tabs.indexIsChanging || _selectedTab == _tabs.index) return;
    setState(() => _selectedTab = _tabs.index);
    widget.terminalSurface?.presentation.setVisible(_selectedTab == 1);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _foreground = state == AppLifecycleState.resumed;
    widget.terminalSurface?.presentation.setForeground(_foreground);
  }

  Future<void> _confirmAndComplete(TaskDetail detail) async {
    final complete = widget.onComplete;
    if (complete == null || widget.completePending) return;
    final running = detail.agentState == 'running';
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Complete “${detail.title}”?'),
        content: Text(
          'This keeps the Completed Task as reference data. Its worktree will be removed asynchronously, and an OpenForge-owned branch may be deleted. Existing branches are kept. Any uncommitted work remaining in the Task worktree will be removed.'
          '${running ? '\n\nThe running Agent and all Task shells will stop before completion.' : ''}',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Complete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    try {
      await widget.terminalSurface?.presentation.closeForTaskCompletion();
    } on Object {
      // The desktop lifecycle remains authoritative and will close the channel.
    }
    final result = await complete();
    if (!mounted) return;
    if (result == TaskCompleteAttempt.completed) {
      setState(() => _completionAccepted = true);
      try {
        await widget.onCompleted?.call();
      } on Object {
        // The refreshed lane owns its own safe unavailable state.
      }
      if (mounted && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      }
      return;
    }
    widget.terminalSurface?.presentation.setVisible(_selectedTab == 1);
  }

  Future<void> _confirmDelete(TaskDetail detail) async {
    final action = widget.onDelete;
    if (_deleteBusy || action == null) return;
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text('Delete “${detail.title}”?'),
        content: const Text(
          'This completes the Task using the desktop lifecycle. The Completed Task stays available as reference data, while runtime workspace state is removed.',
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(false),
            child: const Text('Cancel'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(dialogContext).colorScheme.error,
              foregroundColor: Theme.of(dialogContext).colorScheme.onError,
            ),
            onPressed: () => Navigator.of(dialogContext).pop(true),
            child: const Text('Delete'),
          ),
        ],
      ),
    );
    if (confirmed != true || !mounted) return;

    setState(() => _deleteBusy = true);
    final result = await action();
    if (!mounted) return;
    if (result == TaskDeleteResult.succeeded) {
      await widget.onDeleteSucceeded?.call();
      if (!mounted) return;
      final navigator = Navigator.of(context);
      if (navigator.canPop()) navigator.pop();
    } else if (result == TaskDeleteResult.failed ||
        result == TaskDeleteResult.uncertain) {
      await widget.onDeleteNeedsRefresh?.call();
    }
    if (mounted) setState(() => _deleteBusy = false);
  }

  Widget? _completeAction() {
    final state = widget.state;
    final onComplete = widget.onComplete;
    if (_completionAccepted ||
        state is! TaskDetailLoaded ||
        state.detail.boardStatus != 'doing' ||
        onComplete == null) {
      return null;
    }
    return SafeArea(
      top: false,
      child: _CompleteTaskAction(
        detail: state.detail,
        pending: widget.completePending,
        error: widget.completeError,
        onPressed: () => _confirmAndComplete(state.detail),
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Task'),
      actions: <Widget>[
        IconButton(
          onPressed: () => widget.onRefresh(),
          tooltip: 'Refresh Task detail',
          icon: const Icon(Icons.refresh),
        ),
      ],
      bottom: TabBar(
        controller: _tabs,
        tabs: const <Widget>[
          Tab(text: 'Details'),
          Tab(text: 'Terminal'),
        ],
      ),
    ),
    bottomNavigationBar: _completeAction(),
    body: SafeArea(
      child: IndexedStack(
        index: _selectedTab,
        children: <Widget>[
          _TaskDetailBody(
            state: widget.state,
            onRefresh: widget.onRefresh,
            deleteBusy: _deleteBusy,
            deleteAvailable: widget.onDelete != null,
            onDelete: _confirmDelete,
            startAction: widget.startAction,
            onStart: widget.onStart,
          ),
          AgentTerminalPane(surface: widget.terminalSurface),
        ],
      ),
    ),
  );
}

class _TaskDetailBody extends StatelessWidget {
  const _TaskDetailBody({
    required this.state,
    required this.onRefresh,
    required this.deleteBusy,
    required this.deleteAvailable,
    required this.onDelete,
    required this.startAction,
    required this.onStart,
  });

  final TaskDetailViewState state;
  final Future<void> Function() onRefresh;
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
    required this.deletePending,
    required this.deleteMessage,
    required this.deleteAvailable,
    required this.onDelete,
    required this.startAction,
    required this.onStart,
  });

  final TaskDetail detail;
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
          const SizedBox(height: 16),
          Semantics(
            container: true,
            explicitChildNodes: true,
            label: 'Handoff Notes',
            child: _DetailCard(
              children: <Widget>[
                ExcludeSemantics(
                  child: Text(
                    'Handoff Notes',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(height: 8),
                SelectionArea(
                  child: MarkdownBody(
                    data: visibleHandoff,
                    builders: <String, MarkdownElementBuilder>{
                      'a': _HandoffLinkBuilder(),
                    },
                    imageBuilder: _buildHandoffImagePlaceholder,
                  ),
                ),
              ],
            ),
          ),
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

final class _HandoffLinkBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    markdown.Element element,
    TextStyle? _,
    TextStyle? parentStyle,
  ) {
    final styleSheet = MarkdownStyleSheet.fromTheme(Theme.of(context));
    final children = _buildHandoffLinkSpans(element.children, styleSheet);
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

List<InlineSpan> _buildHandoffLinkSpans(
  List<markdown.Node>? nodes,
  MarkdownStyleSheet styleSheet,
) => <InlineSpan>[
  for (final node in nodes ?? const <markdown.Node>[])
    _buildHandoffLinkSpan(node, styleSheet),
];

InlineSpan _buildHandoffLinkSpan(
  markdown.Node node,
  MarkdownStyleSheet styleSheet,
) {
  if (node is! markdown.Element) return TextSpan(text: node.textContent);
  if (node.tag == 'br') return const TextSpan(text: '\n');
  if (node.tag == 'img') {
    return WidgetSpan(
      alignment: PlaceholderAlignment.middle,
      child: _buildHandoffImagePlaceholder(
        Uri.tryParse(node.attributes['src'] ?? '') ?? Uri(),
        node.attributes['title'],
        node.attributes['alt'],
      ),
    );
  }

  final children = _buildHandoffLinkSpans(node.children, styleSheet);
  final childText = children.map((span) => span.toPlainText()).join();
  final useTextFallback =
      node.textContent.isNotEmpty && childText != node.textContent;
  return TextSpan(
    text: useTextFallback ? node.textContent : null,
    style: styleSheet.styles[node.tag],
    children: useTextFallback ? null : children,
  );
}

Widget _buildHandoffImagePlaceholder(Uri _, String? title, String? alt) {
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
