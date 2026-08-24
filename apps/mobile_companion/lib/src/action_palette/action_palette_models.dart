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

enum MobileMergeMethod { merge, squash, rebase }

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
    this.mergeMethods = const <MobileMergeMethod>[],
    this.defaultMergeMethod,
    this.selectedMergeMethod,
  });

  final CompanionActionId id;
  final MobilePaletteCategory category;
  final String label;
  final List<String> keywords;
  final IconData icon;
  final bool requiresConfirmation;
  final bool destructive;
  final List<MobileMergeMethod> mergeMethods;
  final MobileMergeMethod? defaultMergeMethod;
  final MobileMergeMethod? selectedMergeMethod;

  MobilePaletteAction withSelectedMergeMethod(MobileMergeMethod mergeMethod) =>
      MobilePaletteAction(
        id: id,
        category: category,
        label: label,
        keywords: keywords,
        icon: icon,
        requiresConfirmation: requiresConfirmation,
        destructive: destructive,
        mergeMethods: mergeMethods,
        defaultMergeMethod: defaultMergeMethod,
        selectedMergeMethod: mergeMethod,
      );

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
