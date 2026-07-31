import 'dart:async';

import 'package:flutter/material.dart';

import 'attention/attention_controller.dart';
import 'attention/attention_home.dart';
import 'connection/companion_connection_state.dart';
import 'pairing/companion_pairing_capture.dart';
import 'pairing/companion_pairing_controller.dart';
import 'presentation/connection_shell.dart';

export 'pairing/companion_pairing_capture.dart' show CompanionQrScannerScreen;
export 'presentation/connection_shell.dart' show ConnectionShell;

class CompanionApp extends StatefulWidget {
  const CompanionApp({
    this.controller,
    this.attentionController,
    this.initialState = const Unpaired(),
    super.key,
  });

  final CompanionPairingController? controller;
  final AttentionController? attentionController;
  final CompanionConnectionState initialState;

  @override
  State<CompanionApp> createState() => _CompanionAppState();
}

class _CompanionAppState extends State<CompanionApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late CompanionConnectionState _state;
  late AttentionViewState _attentionState;

  @override
  void initState() {
    super.initState();
    _state = widget.controller?.state ?? widget.initialState;
    _attentionState =
        widget.attentionController?.state ?? const AttentionLoading();
    widget.controller?.addListener(_onControllerChanged);
    widget.attentionController?.addListener(_onAttentionControllerChanged);
    if (_state is Connected && widget.attentionController != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) unawaited(widget.attentionController!.refresh());
      });
    }
  }

  @override
  void dispose() {
    widget.controller?.removeListener(_onControllerChanged);
    widget.attentionController?.removeListener(_onAttentionControllerChanged);
    super.dispose();
  }

  void _onControllerChanged() {
    final previous = _state;
    final next = widget.controller!.state;
    setState(() => _state = next);
    final attentionController = widget.attentionController;
    if (attentionController == null) return;
    if (next is Connected && previous is! Connected) {
      unawaited(attentionController.refresh());
    } else if (next is! Connected && previous is Connected) {
      attentionController.clear();
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

  Future<void> _retryConnection() async {
    await widget.controller?.restore();
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
          )
        : ConnectionShell(
            state: _state,
            onPair: widget.controller == null ? null : _openScanner,
            onReset: widget.controller == null ? null : _forgetAndPairAgain,
            onRetry: widget.controller == null ? null : _retryConnection,
          ),
  );
}
