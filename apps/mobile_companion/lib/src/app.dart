import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import 'action_palette/action_palette_controller.dart';
import 'attention/attention_controller.dart';
import 'attention/attention_home.dart';
import 'connection/companion_connection_coordinator.dart';
import 'connection/companion_connection_state.dart';
import 'live/live_updates_controller.dart';
import 'pairing/companion_pairing_controller.dart';
import 'pairing/companion_pairing_ui_coordinator.dart';
import 'presentation/companion_app_shell.dart';
import 'presentation/companion_connection_view.dart';
import 'project_board/project_board_controller.dart';
import 'project_board/project_board_home.dart';
import 'task_detail/task_detail_coordinator.dart';

export 'task_detail/task_detail_coordinator.dart'
    show AgentTerminalSurfaceFactory, TaskDetailControllerFactory;
export 'pairing/companion_pairing_capture.dart' show CompanionQrScannerScreen;
export 'presentation/connection_shell.dart' show ConnectionShell;

class CompanionApp extends StatefulWidget {
  const CompanionApp({
    this.controller,
    this.projectBoardController,
    this.actionPaletteController,
    this.attentionController,
    this.taskDetailControllerFactory,
    this.agentTerminalSurfaceFactory,
    this.liveUpdatesController,
    this.initialState = const Unpaired(),
    super.key,
  });

  final CompanionPairingController? controller;
  final ProjectBoardController? projectBoardController;
  final MobileActionPaletteController? actionPaletteController;
  final AttentionController? attentionController;
  final TaskDetailControllerFactory? taskDetailControllerFactory;
  final AgentTerminalSurfaceFactory? agentTerminalSurfaceFactory;
  final LiveUpdatesController? liveUpdatesController;
  final CompanionConnectionState initialState;

  @override
  State<CompanionApp> createState() => _CompanionAppState();
}

class _CompanionAppState extends State<CompanionApp>
    with WidgetsBindingObserver {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late AttentionViewState _attentionState;
  late final CompanionConnectionCoordinator _connectionCoordinator;
  late final CompanionPairingUiCoordinator _pairingUiCoordinator;
  late final TaskDetailCoordinator _taskDetailCoordinator;

  CompanionConnectionState get _connectionState =>
      _connectionCoordinator.connectionState;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _attentionState =
        widget.attentionController?.state ?? const AttentionLoading();
    widget.attentionController?.addListener(_onAttentionControllerChanged);

    _connectionCoordinator = CompanionConnectionCoordinator(
      pairingController: widget.controller,
      projectBoardController: widget.projectBoardController,
      attentionController: widget.attentionController,
      liveUpdatesController: widget.liveUpdatesController,
      navigatorKey: _navigatorKey,
      initialState: widget.initialState,
    )..addListener(_onConnectionChanged);
    _pairingUiCoordinator = CompanionPairingUiCoordinator(
      navigatorKey: _navigatorKey,
      controller: widget.controller,
    )..addListener(_onPairingUiChanged);
    _taskDetailCoordinator = TaskDetailCoordinator(
      navigatorKey: _navigatorKey,
      controllerFactory: widget.taskDetailControllerFactory,
      terminalSurfaceFactory: widget.agentTerminalSurfaceFactory,
      projectBoardController: widget.projectBoardController,
      actionPaletteController: widget.actionPaletteController,
      onOpenTaskChanged: _connectionCoordinator.setOpenTask,
    );

    final lifecycleState = WidgetsBinding.instance.lifecycleState;
    if (lifecycleState != null && lifecycleState != AppLifecycleState.resumed) {
      _connectionCoordinator.suspend();
    } else if (_connectionState is Connected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _connectionCoordinator.resume();
      });
    }
  }

  @override
  void didUpdateWidget(covariant CompanionApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    final controllerChanged = oldWidget.controller != widget.controller;
    final boardChanged =
        oldWidget.projectBoardController != widget.projectBoardController;
    final attentionChanged =
        oldWidget.attentionController != widget.attentionController;
    final liveChanged =
        oldWidget.liveUpdatesController != widget.liveUpdatesController;

    if (attentionChanged) {
      oldWidget.attentionController?.removeListener(
        _onAttentionControllerChanged,
      );
      widget.attentionController?.addListener(_onAttentionControllerChanged);
      _attentionState =
          widget.attentionController?.state ?? const AttentionLoading();
    }
    if (controllerChanged) {
      _pairingUiCoordinator.updateController(widget.controller);
    }

    _connectionCoordinator.update(
      pairingController: widget.controller,
      projectBoardController: widget.projectBoardController,
      attentionController: widget.attentionController,
      liveUpdatesController: widget.liveUpdatesController,
      pairingControllerChanged: controllerChanged,
      projectBoardControllerChanged: boardChanged,
      attentionControllerChanged: attentionChanged,
      liveUpdatesControllerChanged: liveChanged,
    );
    _taskDetailCoordinator.update(
      controllerFactory: widget.taskDetailControllerFactory,
      terminalSurfaceFactory: widget.agentTerminalSurfaceFactory,
      projectBoardController: widget.projectBoardController,
      actionPaletteController: widget.actionPaletteController,
      onOpenTaskChanged: _connectionCoordinator.setOpenTask,
    );
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.attentionController?.removeListener(_onAttentionControllerChanged);
    _pairingUiCoordinator
      ..removeListener(_onPairingUiChanged)
      ..dispose();
    _connectionCoordinator
      ..removeListener(_onConnectionChanged)
      ..dispose();
    super.dispose();
  }

  void _onConnectionChanged() {
    if (mounted) setState(() {});
  }

  void _onPairingUiChanged() {
    if (mounted) setState(() {});
  }

  void _onAttentionControllerChanged() {
    if (mounted) {
      setState(() => _attentionState = widget.attentionController!.state);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      _connectionCoordinator.resume();
    } else {
      _connectionCoordinator.suspend();
    }
  }

  @override
  Widget build(BuildContext context) => CompanionAppShell(
    navigatorKey: _navigatorKey,
    home: CompanionConnectionView(
      state: _connectionState,
      connectedView: _connectedView(),
      onPair: widget.controller == null || _pairingUiCoordinator.isActive
          ? null
          : _pairingUiCoordinator.openScanner,
      onManualPair:
          widget.controller == null ||
              !kDebugMode ||
              _pairingUiCoordinator.isActive
          ? null
          : _pairingUiCoordinator.openManualPairing,
      onReset: widget.controller == null
          ? null
          : _pairingUiCoordinator.forgetAndPairAgain,
      onRetry: widget.controller == null
          ? null
          : _pairingUiCoordinator.retryConnection,
      onOpenSettings: widget.controller == null
          ? null
          : _pairingUiCoordinator.openLocalNetworkSettings,
    ),
  );

  Widget? _connectedView() {
    if (_connectionState is! Connected) return null;
    final board = widget.projectBoardController;
    if (board != null) {
      return ProjectBoardHome(
        controller: board,
        actionPaletteController: widget.actionPaletteController,
        onTaskSelected: _taskDetailCoordinator.canOpenTask
            ? _taskDetailCoordinator.openTaskFromSelection
            : null,
      );
    }
    final attention = widget.attentionController;
    if (attention == null) return null;
    return AttentionHome(
      state: _attentionState,
      onRefresh: attention.refresh,
      onTaskSelected: _taskDetailCoordinator.canOpenTask
          ? _taskDetailCoordinator.openTaskFromSelection
          : null,
    );
  }
}
