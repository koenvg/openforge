import 'dart:async';

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

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _state = widget.controller?.state ?? widget.initialState;
    _attentionState =
        widget.attentionController?.state ?? const AttentionLoading();
    widget.controller?.addListener(_onControllerChanged);
    widget.attentionController?.addListener(_onAttentionControllerChanged);
    if (_state is Connected) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted) return;
        final live = widget.liveUpdatesController;
        if (live != null) {
          live.start();
        } else if (widget.attentionController != null) {
          unawaited(widget.attentionController!.refresh());
        }
      });
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    widget.controller?.removeListener(_onControllerChanged);
    widget.attentionController?.removeListener(_onAttentionControllerChanged);
    unawaited(widget.liveUpdatesController?.suspend());
    super.dispose();
  }

  void _onControllerChanged() {
    final previous = _state;
    final next = widget.controller!.state;
    setState(() => _state = next);
    final attentionController = widget.attentionController;
    if (attentionController == null) return;
    if (next is Connected && previous is! Connected) {
      final live = widget.liveUpdatesController;
      if (live != null) {
        live.start();
      } else {
        unawaited(attentionController.refresh());
      }
    } else if (next is! Connected && previous is Connected) {
      attentionController.clear();
      if (next is! Reconnecting) {
        unawaited(widget.liveUpdatesController?.stop());
      }
    }
  }

  void _onAttentionControllerChanged() {
    setState(() => _attentionState = widget.attentionController!.state);
  }

  Future<void> _openScanner() async {
    final controller = widget.controller;
    if (controller == null) return;
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    await captureCompanionPairing(navigator: navigator, controller: controller);
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
    widget.liveUpdatesController?.setOpenTask(controller);
    try {
      await navigator.push<void>(
        MaterialPageRoute<void>(
          builder: (_) => TaskDetailScreen(controller: controller),
        ),
      );
    } finally {
      widget.liveUpdatesController?.setOpenTask(null);
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    final live = widget.liveUpdatesController;
    if (live == null) return;
    if (state == AppLifecycleState.resumed) {
      if (_state is Connected || _state is Reconnecting) live.resume();
    } else {
      unawaited(live.suspend());
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
            onPair: widget.controller == null ? null : _openScanner,
            onReset: widget.controller == null ? null : _forgetAndPairAgain,
            onRetry: widget.controller == null ? null : _retryConnection,
            onOpenSettings: widget.controller == null
                ? null
                : _openLocalNetworkSettings,
          ),
  );
}
