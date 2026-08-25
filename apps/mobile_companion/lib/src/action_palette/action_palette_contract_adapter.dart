import 'package:flutter/material.dart';

import '../generated/companion_v1_client.dart' as generated;
import 'action_palette_models.dart';
import 'merge_method_conversions.dart';

abstract final class MobilePaletteActionContractAdapter {
  static MobilePaletteAction fromTaskPresentation(
    generated.CompanionTaskActionPresentation presentation,
  ) => MobilePaletteAction(
    id: _taskActionId(presentation.id),
    category: MobilePaletteCategory.task,
    label: presentation.label,
    keywords: presentation.keywords,
    icon: _materialIcon(presentation.icon),
    requiresConfirmation: presentation.requiresConfirmation,
    destructive: presentation.destructive,
    mergeMethods:
        (presentation.mergeMethods ??
                const <generated.PullRequestMergeMethod>[])
            .map((method) => method.toMobileMergeMethod())
            .toList(growable: false),
    defaultMergeMethod: presentation.defaultMergeMethod?.toMobileMergeMethod(),
  );

  static MobilePaletteAction fromProjectPresentation(
    generated.CompanionProjectActionPresentation presentation,
  ) => MobilePaletteAction(
    id: _projectActionId(presentation.id),
    category: MobilePaletteCategory.general,
    label: presentation.label,
    keywords: presentation.keywords,
    icon: _materialIcon(presentation.icon),
    requiresConfirmation: presentation.requiresConfirmation,
    destructive: presentation.destructive,
  );

  static CompanionActionId _taskActionId(
    generated.CompanionTaskActionId id,
  ) => switch (id) {
    generated.CompanionTaskActionId.startTask => CompanionActionId.startTask,
    generated.CompanionTaskActionId.mergePullRequest =>
      CompanionActionId.mergePullRequest,
    generated.CompanionTaskActionId.enqueuePullRequest =>
      CompanionActionId.enqueuePullRequest,
    generated.CompanionTaskActionId.returnToBoard =>
      CompanionActionId.returnToBoard,
    generated.CompanionTaskActionId.deleteTask => CompanionActionId.deleteTask,
    generated.CompanionTaskActionId.completeTask =>
      CompanionActionId.completeTask,
    generated.CompanionTaskActionId.setAsideTask =>
      CompanionActionId.setAsideTask,
    generated.CompanionTaskActionId.runApp => CompanionActionId.runApp,
  };

  static CompanionActionId _projectActionId(
    generated.CompanionProjectActionId id,
  ) => switch (id) {
    generated.CompanionProjectActionId.refreshGithub =>
      CompanionActionId.refreshGithub,
  };

  static IconData _materialIcon(generated.CompanionActionIcon icon) =>
      switch (icon) {
        generated.CompanionActionIcon.play => Icons.play_arrow_rounded,
        generated.CompanionActionIcon.merge => Icons.merge_rounded,
        generated.CompanionActionIcon.queue => Icons.queue_rounded,
        generated.CompanionActionIcon.visibility => Icons.visibility_rounded,
        generated.CompanionActionIcon.delete => Icons.delete_outline_rounded,
        generated.CompanionActionIcon.complete => Icons.flag_outlined,
        generated.CompanionActionIcon.visibilityOff =>
          Icons.visibility_off_outlined,
        generated.CompanionActionIcon.rocket => Icons.rocket_launch_outlined,
        generated.CompanionActionIcon.refresh => Icons.sync_rounded,
      };
}
