import 'package:flutter/material.dart';

import 'companion_pairing_capture.dart';
import 'companion_pairing_controller.dart';
import 'companion_pairing_scanner.dart';

final class CompanionPairingUiCoordinator extends ChangeNotifier {
  CompanionPairingUiCoordinator({
    required this._navigatorKey,
    this._controller,
    CompanionPairingCapture qrCapture = captureCompanionPairing,
    CompanionPairingCapture manualCapture = enterCompanionPairingBootstrap,
  }) {
    _scanner = CompanionPairingScanner(
      qrCapture: qrCapture,
      manualCapture: manualCapture,
      onActivityChanged: (_) {
        if (!_disposed) notifyListeners();
      },
    );
  }

  final GlobalKey<NavigatorState> _navigatorKey;
  CompanionPairingController? _controller;
  late final CompanionPairingScanner _scanner;
  var _disposed = false;

  bool get isActive => _scanner.isActive;

  void updateController(CompanionPairingController? controller) {
    _controller = controller;
  }

  Future<void> openScanner() => _capture(_scanner.scan);

  Future<void> openManualPairing() => _capture(_scanner.enterManually);

  Future<void> forgetAndPairAgain() async {
    final controller = _controller;
    if (controller == null) return;
    await controller.forgetAndReset();
    if (!_disposed) await openScanner();
  }

  Future<void> openLocalNetworkSettings() async {
    await _controller?.openLocalNetworkSettings();
  }

  Future<void> retryConnection() async {
    await _controller?.restore();
  }

  Future<void> _capture(
    Future<void> Function({
      required NavigatorState navigator,
      required CompanionPairingController controller,
      required bool Function() isControllerCurrent,
    })
    capture,
  ) async {
    final controller = _controller;
    final navigator = _navigatorKey.currentState;
    if (_disposed || controller == null || navigator == null) return;
    await capture(
      navigator: navigator,
      controller: controller,
      isControllerCurrent: () =>
          !_disposed && identical(_controller, controller),
    );
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
