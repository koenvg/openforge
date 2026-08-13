import 'package:flutter/material.dart';

import '../generated/companion_v1_client.dart' as generated;

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
  static const newTask = MobilePaletteAction.native(
    id: CompanionActionId.newTask,
    label: 'New task',
    keywords: <String>['create', 'add', 'task'],
    icon: Icons.add_task_rounded,
  );

  static const refreshBoard = MobilePaletteAction.native(
    id: CompanionActionId.refreshBoard,
    label: 'Refresh Board',
    keywords: <String>['sync', 'refresh', 'board'],
    icon: Icons.refresh_rounded,
  );
  factory MobilePaletteAction.task(
    generated.CompanionTaskActionPresentation presentation,
  ) => MobilePaletteAction._(
    id: _taskActionId(presentation.id),
    category: MobilePaletteCategory.task,
    label: presentation.label,
    keywords: presentation.keywords,
    icon: _materialIcon(presentation.icon),
    requiresConfirmation: presentation.requiresConfirmation,
    destructive: presentation.destructive,
  );

  factory MobilePaletteAction.project(
    generated.CompanionProjectActionPresentation presentation,
  ) => MobilePaletteAction._(
    id: _projectActionId(presentation.id),
    category: MobilePaletteCategory.general,
    label: presentation.label,
    keywords: presentation.keywords,
    icon: _materialIcon(presentation.icon),
    requiresConfirmation: presentation.requiresConfirmation,
    destructive: presentation.destructive,
  );

  const MobilePaletteAction.native({
    required this.id,
    required this.label,
    required this.keywords,
    required this.icon,
    this.category = MobilePaletteCategory.general,
    this.requiresConfirmation = false,
    this.destructive = false,
  });

  const MobilePaletteAction._({
    required this.id,
    required this.category,
    required this.label,
    required this.keywords,
    required this.icon,
    required this.requiresConfirmation,
    required this.destructive,
  });

  final CompanionActionId id;
  final MobilePaletteCategory category;
  final String label;
  final List<String> keywords;
  final IconData icon;
  final bool requiresConfirmation;
  final bool destructive;

  @override
  bool operator ==(Object other) =>
      other is MobilePaletteAction &&
      other.id == id &&
      other.category == category;

  @override
  int get hashCode => Object.hash(id, category);
}

CompanionActionId _taskActionId(generated.CompanionTaskActionId id) =>
    switch (id) {
      generated.CompanionTaskActionId.startTask => CompanionActionId.startTask,
      generated.CompanionTaskActionId.mergePullRequest =>
        CompanionActionId.mergePullRequest,
      generated.CompanionTaskActionId.enqueuePullRequest =>
        CompanionActionId.enqueuePullRequest,
      generated.CompanionTaskActionId.returnToBoard =>
        CompanionActionId.returnToBoard,
      generated.CompanionTaskActionId.deleteTask =>
        CompanionActionId.deleteTask,
      generated.CompanionTaskActionId.completeTask =>
        CompanionActionId.completeTask,
      generated.CompanionTaskActionId.setAsideTask =>
        CompanionActionId.setAsideTask,
      generated.CompanionTaskActionId.runApp => CompanionActionId.runApp,
    };

CompanionActionId _projectActionId(generated.CompanionProjectActionId id) =>
    switch (id) {
      generated.CompanionProjectActionId.refreshGithub =>
        CompanionActionId.refreshGithub,
    };

IconData _materialIcon(generated.CompanionActionIcon icon) => switch (icon) {
  generated.CompanionActionIcon.play => Icons.play_arrow_rounded,
  generated.CompanionActionIcon.merge => Icons.merge_rounded,
  generated.CompanionActionIcon.queue => Icons.queue_rounded,
  generated.CompanionActionIcon.visibility => Icons.visibility_rounded,
  generated.CompanionActionIcon.delete => Icons.delete_outline_rounded,
  generated.CompanionActionIcon.complete => Icons.flag_outlined,
  generated.CompanionActionIcon.visibilityOff => Icons.visibility_off_outlined,
  generated.CompanionActionIcon.rocket => Icons.rocket_launch_outlined,
  generated.CompanionActionIcon.refresh => Icons.sync_rounded,
};

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
