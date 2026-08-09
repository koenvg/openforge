import 'dart:async';

import 'package:flutter/material.dart';

import '../generated/companion_v1_client.dart';
import '../terminal/agent_terminal_pane.dart';
import '../terminal/agent_terminal_surface.dart';
import 'task_detail_controller.dart';

class TaskDetailScreen extends StatefulWidget {
  const TaskDetailScreen({
    required this.controller,
    this.terminalSurface,
    this.onRefresh,
    super.key,
  });

  final TaskDetailController controller;
  final AgentTerminalSurface? terminalSurface;
  final Future<void> Function()? onRefresh;

  @override
  State<TaskDetailScreen> createState() => _TaskDetailScreenState();
}

class _TaskDetailScreenState extends State<TaskDetailScreen> {
  late TaskDetailViewState _state;

  @override
  void initState() {
    super.initState();
    _state = widget.controller.state;
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
    if (mounted) setState(() => _state = widget.controller.state);
  }

  Future<void> _refresh() =>
      widget.onRefresh?.call() ?? widget.controller.refresh();

  @override
  Widget build(BuildContext context) => TaskDetailView(
    state: _state,
    onRefresh: _refresh,
    terminalSurface: widget.terminalSurface,
  );
}

class TaskDetailView extends StatefulWidget {
  const TaskDetailView({
    required this.state,
    required this.onRefresh,
    this.terminalSurface,
    super.key,
  });

  final TaskDetailViewState state;
  final Future<void> Function() onRefresh;
  final AgentTerminalSurface? terminalSurface;

  @override
  State<TaskDetailView> createState() => _TaskDetailViewState();
}

class _TaskDetailViewState extends State<TaskDetailView>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final TabController _tabs;
  late bool _foreground;
  var _selectedTab = 0;

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
    body: SafeArea(
      child: IndexedStack(
        index: _selectedTab,
        children: <Widget>[
          _TaskDetailBody(state: widget.state, onRefresh: widget.onRefresh),
          AgentTerminalPane(surface: widget.terminalSurface),
        ],
      ),
    ),
  );
}

class _TaskDetailBody extends StatelessWidget {
  const _TaskDetailBody({required this.state, required this.onRefresh});

  final TaskDetailViewState state;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => switch (state) {
    TaskDetailLoading() => Center(
      child: Semantics(
        liveRegion: true,
        label: 'Loading Task detail',
        child: const CircularProgressIndicator(),
      ),
    ),
    TaskDetailLoaded(:final detail) => _LoadedTaskDetail(detail: detail),
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
  const _LoadedTaskDetail({required this.detail});

  final TaskDetail detail;

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
            label: 'Handoff Notes. $visibleHandoff',
            child: ExcludeSemantics(
              child: _DetailCard(
                children: <Widget>[
                  Text(
                    'Handoff Notes',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                  const SizedBox(height: 8),
                  SelectableText(visibleHandoff),
                ],
              ),
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
