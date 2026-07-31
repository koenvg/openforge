import 'package:flutter/material.dart';

import 'connection/companion_connection_state.dart';
import 'pairing/companion_pairing_capture.dart';
import 'pairing/companion_pairing_controller.dart';
import 'presentation/connection_shell.dart';

export 'pairing/companion_pairing_capture.dart' show CompanionQrScannerScreen;
export 'presentation/connection_shell.dart' show ConnectionShell;

class CompanionApp extends StatefulWidget {
  const CompanionApp({
    this.controller,
    this.initialState = const Unpaired(),
    super.key,
  });

  final CompanionPairingController? controller;
  final CompanionConnectionState initialState;

  @override
  State<CompanionApp> createState() => _CompanionAppState();
}

class _CompanionAppState extends State<CompanionApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late CompanionConnectionState _state;

  @override
  void initState() {
    super.initState();
    _state = widget.controller?.state ?? widget.initialState;
    widget.controller?.addListener(_onControllerChanged);
  }

  @override
  void dispose() {
    widget.controller?.removeListener(_onControllerChanged);
    super.dispose();
  }

  void _onControllerChanged() {
    setState(() => _state = widget.controller!.state);
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

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: _navigatorKey,
    debugShowCheckedModeBanner: false,
    title: 'OpenForge Companion',
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      useMaterial3: true,
    ),
    home: ConnectionShell(
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
