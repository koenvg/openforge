import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart' show kDebugMode;
import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'companion_pairing_controller.dart';

Future<void> captureCompanionPairing({
  required NavigatorState navigator,
  required CompanionPairingController controller,
  bool Function()? isControllerCurrent,
}) async {
  _tracePairingLifecycle('QR scanner route push');
  final scannerController = MobileScannerController(autoStart: false);
  final scannerRoute = MaterialPageRoute<String>(
    builder: (_) => CompanionQrScannerScreen(controller: scannerController),
  );
  String? qrPayload;
  try {
    qrPayload = await navigator.push<String>(scannerRoute);
    _tracePairingLifecycle('QR scanner route popped');
    await scannerRoute.completed;
    _tracePairingLifecycle('QR scanner route disposed');
  } finally {
    await scannerController.dispose();
    _tracePairingLifecycle('QR scanner controller disposed');
  }
  if (qrPayload == null ||
      !navigator.mounted ||
      !(isControllerCurrent?.call() ?? true)) {
    return;
  }

  final platform = Platform.isIOS ? 'ios' : 'android';
  final fallbackName = Platform.isIOS ? 'My iPhone' : 'My Android phone';
  final suggestedName = Platform.localHostname.trim();
  final deviceName = await _requestDeviceName(
    navigator.context,
    suggestedName.isEmpty || suggestedName == 'localhost'
        ? fallbackName
        : suggestedName,
  );
  if (deviceName == null ||
      !navigator.mounted ||
      !(isControllerCurrent?.call() ?? true)) {
    _tracePairingLifecycle('controller pairing cancelled after route disposal');
    return;
  }
  _tracePairingLifecycle(
    'device-name route disposed; controller pairing start',
  );

  await controller.pairFromQr(
    qrPayload: qrPayload,
    deviceName: deviceName,
    platform: platform,
  );
  _tracePairingLifecycle('controller pairing completed');
}

Future<void> enterCompanionPairingBootstrap({
  required NavigatorState navigator,
  required CompanionPairingController controller,
  bool Function()? isControllerCurrent,
}) async {
  _tracePairingLifecycle('manual pairing route push');
  final platform = Platform.isIOS ? 'ios' : 'android';
  final fallbackName = Platform.isIOS ? 'My iPhone' : 'My Android phone';
  final suggestedName = Platform.localHostname.trim();
  final route = DialogRoute<_ManualPairingInput>(
    context: navigator.context,
    builder: (_) => _ManualPairingDialog(
      suggestedName: suggestedName.isEmpty || suggestedName == 'localhost'
          ? fallbackName
          : suggestedName,
    ),
  );
  final input = await navigator.push<_ManualPairingInput>(route);
  _tracePairingLifecycle('manual pairing route popped');
  await route.completed;
  _tracePairingLifecycle('manual pairing route disposed');
  if (input == null ||
      !navigator.mounted ||
      !(isControllerCurrent?.call() ?? true)) {
    _tracePairingLifecycle(
      'manual controller pairing cancelled after route disposal',
    );
    return;
  }

  await controller.pairFromQr(
    qrPayload: input.qrPayload,
    deviceName: input.deviceName,
    platform: platform,
  );
  _tracePairingLifecycle('manual controller pairing completed');
}

Future<String?> _requestDeviceName(
  BuildContext context,
  String suggestedName,
) async {
  final route = DialogRoute<String>(
    context: context,
    builder: (_) => _DeviceNameDialog(suggestedName: suggestedName),
  );
  final result = await Navigator.of(
    context,
    rootNavigator: true,
  ).push<String>(route);
  _tracePairingLifecycle('device-name route popped');
  await route.completed;
  _tracePairingLifecycle('device-name route disposed');
  return result;
}

void _tracePairingLifecycle(String event) {
  if (kDebugMode) debugPrint('[CompanionPairingLifecycle] $event');
}

final class _ManualPairingInput {
  const _ManualPairingInput({
    required this.qrPayload,
    required this.deviceName,
  });

  final String qrPayload;
  final String deviceName;
}

class _ManualPairingDialog extends StatefulWidget {
  const _ManualPairingDialog({required this.suggestedName});

  final String suggestedName;

  @override
  State<_ManualPairingDialog> createState() => _ManualPairingDialogState();
}

class _ManualPairingDialogState extends State<_ManualPairingDialog> {
  late final TextEditingController _payloadController;
  late final TextEditingController _nameController;

  @override
  void initState() {
    super.initState();
    _payloadController = TextEditingController();
    _nameController = TextEditingController(text: widget.suggestedName);
  }

  @override
  void dispose() {
    _payloadController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  void _submit() {
    final payload = _payloadController.text.trim();
    final name = _nameController.text.trim();
    if (payload.isEmpty || name.isEmpty) return;
    Navigator.of(
      context,
    ).pop(_ManualPairingInput(qrPayload: payload, deviceName: name));
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Pair without camera'),
    content: SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          TextField(
            key: const Key('manual-pairing-payload'),
            controller: _payloadController,
            autofocus: true,
            minLines: 3,
            maxLines: 6,
            decoration: const InputDecoration(
              labelText: 'Decoded pairing payload',
              helperText: 'Paste the exact short-lived JSON encoded by the QR.',
            ),
          ),
          const SizedBox(height: 16),
          TextField(
            key: const Key('manual-pairing-device-name'),
            controller: _nameController,
            maxLength: 80,
            decoration: const InputDecoration(labelText: 'Device name'),
          ),
        ],
      ),
    ),
    actions: <Widget>[
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      FilledButton(
        key: const Key('submit-manual-pairing'),
        onPressed: _submit,
        child: const Text('Pair directly'),
      ),
    ],
  );
}

class _DeviceNameDialog extends StatefulWidget {
  const _DeviceNameDialog({required this.suggestedName});

  final String suggestedName;

  @override
  State<_DeviceNameDialog> createState() => _DeviceNameDialogState();
}

class _DeviceNameDialogState extends State<_DeviceNameDialog> {
  late final TextEditingController _textController;

  @override
  void initState() {
    super.initState();
    _textController = TextEditingController(text: widget.suggestedName);
  }

  @override
  void dispose() {
    _textController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Name this phone'),
    content: TextField(
      controller: _textController,
      autofocus: true,
      maxLength: 80,
      decoration: const InputDecoration(
        labelText: 'Device name',
        helperText: 'This name will appear on your OpenForge desktop.',
      ),
    ),
    actions: <Widget>[
      TextButton(
        onPressed: () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: () {
          final name = _textController.text.trim();
          if (name.isNotEmpty) Navigator.of(context).pop(name);
        },
        child: const Text('Send request'),
      ),
    ],
  );
}

class CompanionQrScannerScreen extends StatefulWidget {
  const CompanionQrScannerScreen({this.controller, super.key});

  final MobileScannerController? controller;

  @override
  State<CompanionQrScannerScreen> createState() =>
      _CompanionQrScannerScreenState();
}

class _CompanionQrScannerScreenState extends State<CompanionQrScannerScreen>
    with WidgetsBindingObserver {
  late final MobileScannerController _scannerController;
  late final bool _ownsController;
  bool _handled = false;

  @override
  void initState() {
    super.initState();
    _ownsController = widget.controller == null;
    _scannerController =
        widget.controller ?? MobileScannerController(autoStart: false);
    WidgetsBinding.instance.addObserver(this);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) unawaited(_startScanner());
    });
  }

  Future<void> _startScanner() async {
    try {
      await _scannerController.start();
    } on Object catch (error, stackTrace) {
      debugPrint('Failed to start the QR scanner: $error\n$stackTrace');
    }
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final payload = barcode.rawValue;
      if (payload == null) continue;
      _handled = true;
      try {
        await _scannerController.stop();
      } on Object catch (error, stackTrace) {
        debugPrint('Failed to stop the QR scanner: $error\n$stackTrace');
      }
      if (mounted) Navigator.of(context).pop(payload);
      return;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_handled || !_scannerController.value.hasCameraPermission) return;

    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(_startScanner());
      case AppLifecycleState.inactive:
        unawaited(_scannerController.stop());
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
        return;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    if (_ownsController) unawaited(_scannerController.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Scan desktop QR')),
    body: Semantics(
      label: 'Companion pairing QR scanner',
      child: MobileScanner(controller: _scannerController, onDetect: _onDetect),
    ),
  );
}
