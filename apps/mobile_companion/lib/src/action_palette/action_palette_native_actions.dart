import 'package:flutter/material.dart';

import 'action_palette_models.dart';

abstract final class MobileNativePaletteActions {
  static const newTask = MobilePaletteAction(
    id: CompanionActionId.newTask,
    label: 'New task',
    keywords: <String>['create', 'add', 'task'],
    icon: Icons.add_task_rounded,
  );

  static const refreshBoard = MobilePaletteAction(
    id: CompanionActionId.refreshBoard,
    label: 'Refresh Board',
    keywords: <String>['sync', 'refresh', 'board'],
    icon: Icons.refresh_rounded,
  );
}
