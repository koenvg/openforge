import 'package:flutter/widgets.dart';

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
  const MobilePaletteAction({
    required this.id,
    required this.label,
    required this.keywords,
    required this.icon,
    this.category = MobilePaletteCategory.general,
    this.requiresConfirmation = false,
    this.destructive = false,
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

typedef PaletteActionExecutor =
    Future<void> Function(MobilePaletteAction action);
typedef PaletteActionConfirmer =
    Future<bool> Function(MobilePaletteAction action);
