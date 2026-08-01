import 'dart:async';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';

import 'attention/attention_controller.dart';
import 'attention/attention_home.dart';
import 'connection/companion_connection_state.dart';
import 'live/live_updates_controller.dart';
import 'pairing/companion_pairing_capture.dart';
import 'pairing/companion_pairing_controller.dart';
import 'presentation/connection_shell.dart';
import 'task_detail/task_detail_controller.dart';
import 'task_detail/task_detail_screen.dart';

export 'pairing/companion_pairing_capture.dart' show CompanionQrScannerScreen;
export 'presentation/connection_shell.dart' show ConnectionShell;

typedef TaskDetailControllerFactory =
    TaskDetailController Function(String taskId);

class CompanionApp extends StatefulWidget {
  const CompanionApp({
    this.controller,
    this.attentionController,
    this.taskDetailControllerFactory,
    this.liveUpdatesController,
    this.initialState = const Unpaired(),
    super.key,
  });

  final CompanionPairingController? controller;
  final AttentionController? attentionController;
  final TaskDetailControllerFactory? taskDetailControllerFactory;
  final LiveUpdatesController? liveUpdatesController;
  final CompanionConnectionState initialState;

  @override
  State<CompanionApp> createState() => _CompanionAppState();
}

class _CompanionAppState extends State<CompanionApp>
    with WidgetsBindingObserver {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late CompanionConnectionState _state;
  late AttentionViewState _attentionState;
  TaskDetailController? _openTaskController;
  var _pairingFlowActive = false;
  late bool _isForeground;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _isForeground =
        WidgetsBinding.instance.lifecycleState == null ||
        WidgetsBinding.instance.lifecycleState == AppLifecycleState.resumed;
    _state = widget.controller?.state ?? widget.initialState;
    _attentionState =
        widget.attentionController?.state ?? const AttentionLoading();
    widget.controller?.addListener(_onControllerChanged);
    widget.attentionController?.addListener(_onAttentionControllerChanged);
    _configureLiveController(widget.liveUpdatesController);
    if (_state is Connected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) _resumeUpdatesForCurrentState();
      });
    }
  }

  @override
  void didUpdateWidget(covariant CompanionApp oldWidget) {
    super.didUpdateWidget(oldWidget);
    final previousState = _state;
    final controllerChanged = oldWidget.controller != widget.controller;
    final attentionChanged =
        oldWidget.attentionController != widget.attentionController;
    final liveChanged =
        oldWidget.liveUpdatesController != widget.liveUpdatesController;

    if (controllerChanged) {
      oldWidget.controller?.cancelPendingOperation();
      oldWidget.controller?.removeListener(_onControllerChanged);
      widget.controller?.addListener(_onControllerChanged);
      _state = widget.controller?.state ?? widget.initialState;
    }

    if (attentionChanged) {
      oldWidget.attentionController?.removeListener(
        _onAttentionControllerChanged,
      );
      widget.attentionController?.addListener(_onAttentionControllerChanged);
      _attentionState =
          widget.attentionController?.state ?? const AttentionLoading();
    }
    if (attentionChanged && !liveChanged) {
      widget.liveUpdatesController?.setAttentionController(
        widget.attentionController,
      );
    }

    if (liveChanged) {
      _releaseLiveController(oldWidget.liveUpdatesController);
    } else if (controllerChanged) {
      _clearLiveCallbacks(widget.liveUpdatesController);
      unawaited(widget.liveUpdatesController?.stop());
    } else if (attentionChanged) {
      unawaited(widget.liveUpdatesController?.suspend());
    }

    _configureLiveController(widget.liveUpdatesController);

    if (controllerChanged || attentionChanged || liveChanged) {
      _reconcileConnectionState(
        previousState,
        ownershipChanged: controllerChanged || attentionChanged || liveChanged,
      );
    }
  }

  @override
  void dispose() {
    _isForeground = false;
    WidgetsBinding.instance.removeObserver(this);
    widget.controller?.removeListener(_onControllerChanged);
    widget.attentionController?.removeListener(_onAttentionControllerChanged);
    _releaseLiveController(widget.liveUpdatesController);
    super.dispose();
  }

  void _onControllerChanged() {
    final previous = _state;
    final next = widget.controller!.state;
    setState(() => _state = next);
    _reconcileConnectionState(previous);
  }

  void _reconcileConnectionState(
    CompanionConnectionState previous, {
    bool ownershipChanged = false,
  }) {
    final wasActive = previous is Connected || previous is Reconnecting;
    final isActive = _state is Connected || _state is Reconnecting;
    final becameConnected = _state is Connected && previous is! Connected;

    if (_state is! Connected && previous is Connected) {
      _navigatorKey.currentState?.popUntil((route) => route.isFirst);
      widget.attentionController?.clear();
    }
    if (wasActive && !isActive) {
      unawaited(widget.liveUpdatesController?.stop());
    }
    if ((isActive && !wasActive) || becameConnected || ownershipChanged) {
      _resumeUpdatesForCurrentState();
    }
  }

  void _resumeUpdatesForCurrentState() {
    if (!_isForeground) return;
    final attentionController = widget.attentionController;
    if (attentionController == null) return;

    final live = widget.liveUpdatesController;
    if (live != null) {
      _configureLiveController(live);
      if (_state is Connected || _state is Reconnecting) live.resume();
    } else if (_state is Connected) {
      unawaited(attentionController.refresh());
    }
  }

  void _configureLiveController(LiveUpdatesController? live) {
    if (live == null) return;
    live.setConnectionCallbacks(
      onReconnecting: widget.controller?.liveReconnecting,
      onConnected: widget.controller?.liveConnected,
      onUnavailable: widget.controller?.liveUnavailable,
      onAuthorizationLost: widget.controller?.authorizationLost,
      onCertificateMismatch: widget.controller?.liveCertificateMismatch,
      onIncompatible: widget.controller?.liveIncompatible,
    );
    live.setAttentionController(widget.attentionController);
    live.setOpenTask(_openTaskController);
  }

  void _clearLiveCallbacks(LiveUpdatesController? live) {
    live?.setConnectionCallbacks(
      onReconnecting: null,
      onConnected: null,
      onUnavailable: null,
      onAuthorizationLost: null,
      onCertificateMismatch: null,
      onIncompatible: null,
    );
  }

  void _releaseLiveController(LiveUpdatesController? live) {
    live?.setOpenTask(null);
    live?.setAttentionController(null);
    _clearLiveCallbacks(live);
    unawaited(live?.suspend());
  }

  void _onAttentionControllerChanged() {
    setState(() => _attentionState = widget.attentionController!.state);
  }

  Future<void> _openScanner() async {
    final controller = widget.controller;
    if (controller == null) return;
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    await _runPairingFlow(
      () => captureCompanionPairing(
        navigator: navigator,
        controller: controller,
        isControllerCurrent: () =>
            mounted && identical(widget.controller, controller),
      ),
    );
  }

  Future<void> _openManualPairing() async {
    final controller = widget.controller;
    if (controller == null) return;
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    await _runPairingFlow(
      () => enterCompanionPairingBootstrap(
        navigator: navigator,
        controller: controller,
        isControllerCurrent: () =>
            mounted && identical(widget.controller, controller),
      ),
    );
  }

  Future<void> _runPairingFlow(Future<void> Function() flow) async {
    if (_pairingFlowActive) return;
    setState(() => _pairingFlowActive = true);
    try {
      await flow();
    } finally {
      if (mounted) {
        setState(() => _pairingFlowActive = false);
      } else {
        _pairingFlowActive = false;
      }
    }
  }

  Future<void> _forgetAndPairAgain() async {
    final controller = widget.controller;
    if (controller == null) return;
    await controller.forgetAndReset();
    if (mounted) await _openScanner();
  }

  Future<void> _openLocalNetworkSettings() async {
    await widget.controller?.openLocalNetworkSettings();
  }

  Future<void> _retryConnection() async {
    await widget.controller?.restore();
  }

  void _openTaskDetail(String taskId) {
    unawaited(_pushTaskDetail(taskId));
  }

  Future<void> _pushTaskDetail(String taskId) async {
    final factory = widget.taskDetailControllerFactory;
    final navigator = _navigatorKey.currentState;
    if (factory == null || navigator == null) return;
    final controller = factory(taskId);
    _openTaskController = controller;
    widget.liveUpdatesController?.setOpenTask(controller);
    try {
      await navigator.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => TaskDetailScreen(controller: controller),
        ),
      );
    } finally {
      if (identical(_openTaskController, controller)) {
        widget.liveUpdatesController?.setOpenTask(null);
        _openTaskController = null;
      }
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    _isForeground = state == AppLifecycleState.resumed;
    if (_isForeground) {
      _resumeUpdatesForCurrentState();
    } else {
      unawaited(widget.liveUpdatesController?.suspend());
    }
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: _navigatorKey,
    debugShowCheckedModeBanner: false,
    title: 'OpenForge Companion',
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      useMaterial3: true,
    ),
    home: _state is Connected && widget.attentionController != null
        ? AttentionHome(
            state: _attentionState,
            onRefresh: widget.attentionController!.refresh,
            onTaskSelected: widget.taskDetailControllerFactory == null
                ? null
                : _openTaskDetail,
          )
        : ConnectionShell(
            state: _state,
            onPair: widget.controller == null || _pairingFlowActive
                ? null
                : _openScanner,
            onManualPair:
                widget.controller == null || !kDebugMode || _pairingFlowActive
                ? null
                : _openManualPairing,
            onReset: widget.controller == null ? null : _forgetAndPairAgain,
            onRetry: widget.controller == null ? null : _retryConnection,
            onOpenSettings: widget.controller == null
                ? null
                : _openLocalNetworkSettings,
          ),
  );
}
