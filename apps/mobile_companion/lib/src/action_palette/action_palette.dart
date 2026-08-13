import 'package:flutter/material.dart';

enum CompanionActionId {
  startTask,
  mergePullRequest,
  enqueuePullRequest,
  returnToBoard,
  deleteTask,
  completeTask,
  setAsideTask,
  runApp,
  newTask,
  refreshBoard,
  refreshGithub,
}

enum MobilePaletteCategory { task, general }

final class MobilePaletteAction {
  const MobilePaletteAction.task(this.id)
    : category = MobilePaletteCategory.task;
  const MobilePaletteAction.general(this.id)
    : category = MobilePaletteCategory.general;

  final CompanionActionId id;
  final MobilePaletteCategory category;

  @override
  bool operator ==(Object other) =>
      other is MobilePaletteAction &&
      other.id == id &&
      other.category == category;

  @override
  int get hashCode => Object.hash(id, category);

  String get label => switch (id) {
    CompanionActionId.startTask => 'Start Task',
    CompanionActionId.mergePullRequest => 'Merge Pull Request',
    CompanionActionId.enqueuePullRequest => 'Enqueue Pull Request',
    CompanionActionId.returnToBoard => 'Move task back in focus',
    CompanionActionId.deleteTask => 'Delete',
    CompanionActionId.completeTask => 'Complete',
    CompanionActionId.setAsideTask => 'Set aside',
    CompanionActionId.runApp => 'Run app',
    CompanionActionId.newTask => 'New task',
    CompanionActionId.refreshBoard => 'Refresh Board',
    CompanionActionId.refreshGithub => 'Refresh GitHub',
  };

  List<String> get keywords => switch (id) {
    CompanionActionId.startTask => const <String>[
      'run',
      'execute',
      'begin',
      'agent',
    ],
    CompanionActionId.mergePullRequest => const <String>[
      'merge',
      'pull request',
      'pr',
      'github',
    ],
    CompanionActionId.enqueuePullRequest => const <String>[
      'enqueue',
      'merge queue',
      'pull request',
      'pr',
    ],
    CompanionActionId.returnToBoard => const <String>[
      'focus',
      'board',
      'move',
      'out of focus',
    ],
    CompanionActionId.deleteTask || CompanionActionId.completeTask =>
      const <String>['remove', 'trash', 'complete', 'finish', 'close', 'done'],
    CompanionActionId.setAsideTask => const <String>[
      'set aside',
      'out of focus',
      'hide',
      'defer',
    ],
    CompanionActionId.runApp => const <String>[
      'run',
      'app',
      'local',
      'terminal',
      'serve',
      'dev',
    ],
    CompanionActionId.newTask => const <String>['create', 'add', 'task'],
    CompanionActionId.refreshBoard => const <String>[
      'sync',
      'refresh',
      'board',
    ],
    CompanionActionId.refreshGithub => const <String>[
      'sync',
      'github',
      'refresh',
      'pull',
    ],
  };

  bool get requiresConfirmation => switch (id) {
    CompanionActionId.deleteTask || CompanionActionId.completeTask => true,
    _ => false,
  };

  bool get destructive =>
      id == CompanionActionId.deleteTask ||
      id == CompanionActionId.completeTask;

  IconData get icon => switch (id) {
    CompanionActionId.startTask => Icons.play_arrow_rounded,
    CompanionActionId.mergePullRequest => Icons.merge_rounded,
    CompanionActionId.enqueuePullRequest => Icons.queue_rounded,
    CompanionActionId.returnToBoard => Icons.visibility_rounded,
    CompanionActionId.deleteTask => Icons.delete_outline_rounded,
    CompanionActionId.completeTask => Icons.flag_outlined,
    CompanionActionId.setAsideTask => Icons.visibility_off_outlined,
    CompanionActionId.runApp => Icons.rocket_launch_outlined,
    CompanionActionId.newTask => Icons.add_task_rounded,
    CompanionActionId.refreshBoard => Icons.refresh_rounded,
    CompanionActionId.refreshGithub => Icons.sync_rounded,
  };
}

typedef PaletteActionExecutor =
    Future<void> Function(MobilePaletteAction action);
typedef PaletteActionConfirmer =
    Future<bool> Function(MobilePaletteAction action);

Future<MobilePaletteAction?> showMobileActionPalette({
  required BuildContext context,
  required String title,
  required Future<List<MobilePaletteAction>> actions,
  PaletteActionConfirmer? onConfirm,
}) => showModalBottomSheet<MobilePaletteAction>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (sheetContext) => FractionallySizedBox(
    heightFactor: 0.72,
    child: FutureBuilder<List<MobilePaletteAction>>(
      future: actions,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Center(
            child: Text('Actions are temporarily unavailable.'),
          );
        }
        final loaded = snapshot.data;
        if (loaded == null) {
          return const Center(child: CircularProgressIndicator());
        }
        return MobileActionPalette(
          title: title,
          actions: loaded,
          onConfirm: onConfirm,
          onExecute: (action) async => Navigator.of(sheetContext).pop(action),
        );
      },
    ),
  ),
);

class MobileActionPalette extends StatefulWidget {
  const MobileActionPalette({
    required this.title,
    required this.actions,
    required this.onExecute,
    this.onConfirm,
    super.key,
  });

  final String title;
  final List<MobilePaletteAction> actions;
  final PaletteActionExecutor onExecute;
  final PaletteActionConfirmer? onConfirm;

  @override
  State<MobileActionPalette> createState() => _MobileActionPaletteState();
}

class _MobileActionPaletteState extends State<MobileActionPalette> {
  var _query = '';
  CompanionActionId? _pending;

  List<MobilePaletteAction> get _filteredActions {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return widget.actions;
    return widget.actions
        .where(
          (action) =>
              action.label.toLowerCase().contains(query) ||
              action.keywords.any((keyword) => keyword.contains(query)),
        )
        .toList(growable: false);
  }

  Future<void> _execute(MobilePaletteAction action) async {
    if (_pending != null) return;
    final confirm = widget.onConfirm;
    if (action.requiresConfirmation &&
        (confirm == null || !await confirm(action))) {
      return;
    }
    if (!mounted) return;
    setState(() => _pending = action.id);
    try {
      await widget.onExecute(action);
    } finally {
      if (mounted) setState(() => _pending = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final actions = _filteredActions;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              onChanged: (value) => setState(() => _query = value),
              decoration: const InputDecoration(
                labelText: 'Filter actions',
                prefixIcon: Icon(Icons.search_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            if (actions.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No matching actions', textAlign: TextAlign.center),
              )
            else
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: actions.length,
                  itemBuilder: (context, index) {
                    final action = actions[index];
                    final pending = _pending == action.id;
                    final color = action.destructive
                        ? Theme.of(context).colorScheme.error
                        : null;
                    return ListTile(
                      minTileHeight: 48,
                      leading: pending
                          ? const SizedBox.square(
                              dimension: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(action.icon, color: color),
                      title: Text(action.label, style: TextStyle(color: color)),
                      enabled: _pending == null,
                      onTap: () => _execute(action),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
