import 'dart:io';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'companion_pairing_controller.dart';

Future<void> captureCompanionPairing({
  required NavigatorState navigator,
  required CompanionPairingController controller,
}) async {
  final qrPayload = await navigator.push<String>(
    MaterialPageRoute<String>(builder: (_) => const CompanionQrScannerScreen()),
  );
  if (qrPayload == null || !navigator.mounted) return;

  final platform = Platform.isIOS ? 'ios' : 'android';
  final fallbackName = Platform.isIOS ? 'My iPhone' : 'My Android phone';
  final suggestedName = Platform.localHostname.trim();
  final deviceName = await _requestDeviceName(
    navigator.context,
    suggestedName.isEmpty || suggestedName == 'localhost'
        ? fallbackName
        : suggestedName,
  );
  if (deviceName == null || !navigator.mounted) return;

  await controller.pairFromQr(
    qrPayload: qrPayload,
    deviceName: deviceName,
    platform: platform,
  );
}

Future<String?> _requestDeviceName(
  BuildContext context,
  String suggestedName,
) async {
  final textController = TextEditingController(text: suggestedName);
  final result = await showDialog<String>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('Name this phone'),
      content: TextField(
        controller: textController,
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
            final name = textController.text.trim();
            if (name.isNotEmpty) Navigator.of(context).pop(name);
          },
          child: const Text('Send request'),
        ),
      ],
    ),
  );
  textController.dispose();
  return result;
}

class CompanionQrScannerScreen extends StatefulWidget {
  const CompanionQrScannerScreen({super.key});

  @override
  State<CompanionQrScannerScreen> createState() =>
      _CompanionQrScannerScreenState();
}

class _CompanionQrScannerScreenState extends State<CompanionQrScannerScreen> {
  bool _handled = false;

  void _onDetect(BarcodeCapture capture) {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final payload = barcode.rawValue;
      if (payload == null) continue;
      _handled = true;
      Navigator.of(context).pop(payload);
      return;
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Scan desktop QR')),
    body: Semantics(
      label: 'Companion pairing QR scanner',
      child: MobileScanner(onDetect: _onDetect),
    ),
  );
}
