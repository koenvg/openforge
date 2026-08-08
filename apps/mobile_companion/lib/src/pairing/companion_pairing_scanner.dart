import 'package:flutter/material.dart';

import 'companion_pairing_capture.dart';
import 'companion_pairing_controller.dart';

typedef CompanionPairingCapture =
    Future<void> Function({
      required NavigatorState navigator,
      required CompanionPairingController controller,
      required bool Function() isControllerCurrent,
    });

final class CompanionPairingScanner {
  factory CompanionPairingScanner({
    CompanionPairingCapture qrCapture = captureCompanionPairing,
    CompanionPairingCapture manualCapture = enterCompanionPairingBootstrap,
    void Function(bool isActive)? onActivityChanged,
  }) => CompanionPairingScanner._(qrCapture, manualCapture, onActivityChanged);

  CompanionPairingScanner._(
    this._qrCapture,
    this._manualCapture,
    this._onActivityChanged,
  );

  final CompanionPairingCapture _qrCapture;
  final CompanionPairingCapture _manualCapture;
  final void Function(bool isActive)? _onActivityChanged;

  bool _isActive = false;

  bool get isActive => _isActive;

  Future<void> scan({
    required NavigatorState navigator,
    required CompanionPairingController controller,
    required bool Function() isControllerCurrent,
  }) => _run(
    () => _qrCapture(
      navigator: navigator,
      controller: controller,
      isControllerCurrent: isControllerCurrent,
    ),
  );

  Future<void> enterManually({
    required NavigatorState navigator,
    required CompanionPairingController controller,
    required bool Function() isControllerCurrent,
  }) => _run(
    () => _manualCapture(
      navigator: navigator,
      controller: controller,
      isControllerCurrent: isControllerCurrent,
    ),
  );

  Future<void> _run(Future<void> Function() capture) async {
    if (_isActive) return;
    _isActive = true;
    _onActivityChanged?.call(true);
    try {
      await capture();
    } finally {
      _isActive = false;
      _onActivityChanged?.call(false);
    }
  }
}
