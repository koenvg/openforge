import 'dart:async';

import 'package:flutter/material.dart';

import '../action_palette/action_palette_controller.dart';
import '../project_board/project_board_controller.dart';
import '../terminal/agent_terminal_surface.dart';
import 'task_detail_controller.dart';
import 'task_detail_screen.dart';

typedef TaskDetailControllerFactory =
    TaskDetailController Function(String taskId);
typedef AgentTerminalSurfaceFactory =
    AgentTerminalSurface Function(String taskId);

final class TaskDetailCoordinator {
  TaskDetailCoordinator({
    required this._navigatorKey,
    this._controllerFactory,
    this._terminalSurfaceFactory,
    this._projectBoardController,
    this._actionPaletteController,
    this._onOpenTaskChanged,
  });

  final GlobalKey<NavigatorState> _navigatorKey;
  TaskDetailControllerFactory? _controllerFactory;
  AgentTerminalSurfaceFactory? _terminalSurfaceFactory;
  ProjectBoardController? _projectBoardController;
  MobileActionPaletteController? _actionPaletteController;
  void Function(TaskDetailController? controller)? _onOpenTaskChanged;
  TaskDetailController? _openTaskController;

  TaskDetailController? get openTaskController => _openTaskController;
  bool get canOpenTask => _controllerFactory != null;

  void update({
    TaskDetailControllerFactory? controllerFactory,
    AgentTerminalSurfaceFactory? terminalSurfaceFactory,
    ProjectBoardController? projectBoardController,
    MobileActionPaletteController? actionPaletteController,
    void Function(TaskDetailController? controller)? onOpenTaskChanged,
  }) {
    _controllerFactory = controllerFactory;
    _terminalSurfaceFactory = terminalSurfaceFactory;
    _projectBoardController = projectBoardController;
    _actionPaletteController = actionPaletteController;
    _onOpenTaskChanged = onOpenTaskChanged;
    _onOpenTaskChanged?.call(_openTaskController);
  }

  void openTaskFromSelection(String taskId) {
    unawaited(openTask(taskId));
  }

  Future<void> openTask(String taskId) async {
    final factory = _controllerFactory;
    final navigator = _navigatorKey.currentState;
    if (factory == null || navigator == null) return;
    final controller = factory(taskId);
    final terminalSurface = _terminalSurfaceFactory?.call(taskId);
    final previousController = _openTaskController;
    _setOpenTask(controller);
    try {
      await navigator.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => TaskDetailScreen(
            controller: controller,
            terminalSurface: terminalSurface,
            actionPaletteController: _actionPaletteController,
            onRefresh: () => refreshTaskAndBoard(controller),
            onOpenTask: openTaskFromSelection,
            onCompleted: refreshBoard,
            onDeleteSucceeded: refreshBoard,
            onDeleteNeedsRefresh: refreshBoard,
          ),
        ),
      );
    } finally {
      if (identical(_openTaskController, controller)) {
        _setOpenTask(previousController);
      }
    }
  }

  Future<void> refreshTaskAndBoard(TaskDetailController taskDetail) async {
    final board = _projectBoardController;
    if (board == null) {
      await taskDetail.refresh();
      return;
    }
    await Future.wait(<Future<void>>[board.refresh(), taskDetail.refresh()]);
  }

  Future<void> refreshBoard() async {
    await _projectBoardController?.refresh();
  }

  void _setOpenTask(TaskDetailController? controller) {
    _openTaskController = controller;
    _onOpenTaskChanged?.call(controller);
  }
}
