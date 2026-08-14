import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as markdown;

import '../design_system/quiet_paper_theme.dart';

import '../action_palette/action_palette.dart';
import '../action_palette/action_palette_controller.dart';
import '../companion_app_lifecycle.dart';
import '../generated/companion_v1_client.dart';
import '../terminal/agent_terminal_pane.dart';
import '../terminal/agent_terminal_surface.dart';
import 'task_detail_controller.dart';

part 'task_detail_actions.dart';
part 'task_detail_content.dart';
part 'task_detail_metadata.dart';
part 'task_detail_tabs.dart';

class TaskDetailScreen extends StatefulWidget {
  const TaskDetailScreen({
    required this.controller,
    this.terminalSurface,
    this.actionPaletteController,
    this.onRefresh,
    this.onOpenTask,
    this.onCompleted,
    this.onDeleteSucceeded,
    this.onDeleteNeedsRefresh,
    super.key,
  });

  final TaskDetailController controller;
  final AgentTerminalSurface? terminalSurface;
  final MobileActionPaletteController? actionPaletteController;
  final Future<void> Function()? onRefresh;
  final void Function(String taskId)? onOpenTask;
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
    onOpenTask: widget.onOpenTask,
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
    actionPaletteController: widget.actionPaletteController,
  );
}

class TaskDetailView extends StatefulWidget {
  const TaskDetailView({
    required this.state,
    required this.onRefresh,
    this.onOpenTask,
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
    this.actionPaletteController,
    super.key,
  });

  final TaskDetailViewState state;
  final Future<void> Function() onRefresh;
  final void Function(String taskId)? onOpenTask;
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
  final MobileActionPaletteController? actionPaletteController;

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
    _foreground = keepsCompanionSessionActive(lifecycleState);
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
    _foreground = keepsCompanionSessionActive(state);
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
          'This permanently deletes the Task and removes any runtime workspace state. The Task will not remain available as reference data. This cannot be undone.',
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

  Future<bool> _confirmPaletteAction(
    MobilePaletteAction action,
    TaskDetail detail,
  ) async {
    if (!action.requiresConfirmation) return true;
    final message = mobileActionPaletteConfirmationMessage(
      action,
      agentRunning: detail.agentState == 'running',
    );
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text('${action.label} “${detail.title}”?'),
            content: Text(message),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: Text(action.label),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _openActionPalette() async {
    final palette = widget.actionPaletteController;
    final state = widget.state;
    if (palette == null || state is! TaskDetailLoaded) return;
    final detail = state.detail;
    final action = await showMobileActionPalette(
      context: context,
      title: 'Task actions',
      actions: palette.loadTaskActions(detail.taskId),
      onConfirm: (action) => _confirmPaletteAction(action, detail),
    );
    if (!mounted || action == null) return;
    final terminal =
        action.id == CompanionActionId.completeTask ||
        action.id == CompanionActionId.deleteTask;
    try {
      if (terminal) {
        try {
          await widget.terminalSurface?.presentation.closeForTaskCompletion();
        } on Object {
          // The desktop lifecycle remains authoritative and closes the channel.
        }
      }
      await palette.executeTaskAction(detail.taskId, action.id);
      if (!mounted) return;
      if (action.id == CompanionActionId.completeTask) {
        await widget.onCompleted?.call();
      } else if (action.id == CompanionActionId.deleteTask) {
        await widget.onDeleteSucceeded?.call();
      } else {
        await widget.onRefresh();
      }
      if (!mounted) return;
      if (terminal && Navigator.of(context).canPop()) {
        Navigator.of(context).pop();
      } else {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('${action.label} completed.')));
      }
    } on Object {
      if (!mounted) return;
      await widget.onRefresh();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${action.label} failed. Task state was refreshed.'),
          ),
        );
      }
    }
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
  Widget build(BuildContext context) => _TaskDetailTabs(
    controller: _tabs,
    selectedTab: _selectedTab,
    onRefresh: widget.onRefresh,
    onActions: widget.actionPaletteController == null
        ? null
        : _openActionPalette,
    bottomAction: _completeAction(),
    details: _TaskDetailBody(
      state: widget.state,
      onRefresh: widget.onRefresh,
      onOpenTask: widget.onOpenTask,
      deleteBusy: _deleteBusy,
      deleteAvailable:
          widget.onDelete != null && widget.actionPaletteController == null,
      onDelete: _confirmDelete,
      startAction: widget.startAction,
      onStart: widget.onStart,
    ),
    terminalSurface: widget.terminalSurface,
  );
}
