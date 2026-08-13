import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_capture.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/widget_test_fakes.dart';

const _hostId = '65d91f21-6732-45a6-9418-3dfaf4c93f52';
const _endpoint = 'https://desktop.example.ts.net:17424';
const _oneTimeSecret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const _qrPayload =
    '{"protocolVersion":2,"hostId":"$_hostId",'
    '"certificateSha256":"9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A",'
    '"endpointCandidates":["$_endpoint"],'
    '"oneTimeSecret":"$_oneTimeSecret"}';

void main() {
  testWidgets(
    'forwards the scanner payload and trimmed device name through the controller',
    (tester) async {
      final scannerPlatform = FakeMobileScannerPlatform();
      installScannerPlatform(scannerPlatform);
      final client = _RecordingPairingClient();
      final controller = CompanionPairingController(
        client: client,
        storage: _MemorySecureStorage(),
        pollInterval: Duration.zero,
      );
      addTearDown(controller.dispose);
      late Future<void> capture;

      await tester.pumpWidget(
        _CaptureLauncher(
          controller: controller,
          onCaptureStarted: (value) => capture = value,
        ),
      );
      await tester.tap(find.text('Capture pairing'));
      await tester.pumpAndSettle();

      scannerPlatform.addBarcode(
        const BarcodeCapture(
          barcodes: <Barcode>[
            Barcode(format: BarcodeFormat.qrCode),
            Barcode(format: BarcodeFormat.qrCode, rawValue: _qrPayload),
          ],
        ),
      );
      await tester.pumpAndSettle();
      expect(find.text('Name this phone'), findsOneWidget);

      await tester.enterText(find.byType(TextField), '  Pocket Pixel  ');
      await tester.tap(find.text('Send request'));
      await tester.pumpAndSettle();
      await capture;

      expect(client.submitCalls, 1);
      expect(client.submittedBootstrap?.hostId, _hostId);
      expect(client.submittedBootstrap?.oneTimeSecret, _oneTimeSecret);
      expect(client.submittedDeviceName, 'Pocket Pixel');
      expect(client.submittedPlatform, 'android');
    },
  );

  testWidgets('cancelling the device name skips controller pairing', (
    tester,
  ) async {
    final scannerPlatform = FakeMobileScannerPlatform();
    installScannerPlatform(scannerPlatform);
    final client = _RecordingPairingClient();
    final controller = CompanionPairingController(
      client: client,
      storage: _MemorySecureStorage(),
      pollInterval: Duration.zero,
    );
    addTearDown(controller.dispose);
    late Future<void> capture;

    await tester.pumpWidget(
      _CaptureLauncher(
        controller: controller,
        onCaptureStarted: (value) => capture = value,
      ),
    );
    await tester.tap(find.text('Capture pairing'));
    await tester.pumpAndSettle();

    scannerPlatform.addBarcode(
      const BarcodeCapture(barcodes: <Barcode>[Barcode(rawValue: _qrPayload)]),
    );
    await tester.pumpAndSettle();
    expect(find.text('Name this phone'), findsOneWidget);

    await tester.tap(find.text('Cancel'));
    await tester.pumpAndSettle();
    await capture;

    expect(client.submitCalls, 0);
    expect(client.submittedBootstrap, isNull);
    expect(find.text('Capture pairing'), findsOneWidget);
  });
}

final class _CaptureLauncher extends StatelessWidget {
  const _CaptureLauncher({
    required this.controller,
    required this.onCaptureStarted,
  });

  final CompanionPairingController controller;
  final ValueChanged<Future<void>> onCaptureStarted;

  @override
  Widget build(BuildContext context) => MaterialApp(
    home: Builder(
      builder: (context) => Scaffold(
        body: FilledButton(
          onPressed: () => onCaptureStarted(
            captureCompanionPairing(
              navigator: Navigator.of(context),
              controller: controller,
            ),
          ),
          child: const Text('Capture pairing'),
        ),
      ),
    ),
  );
}

final class _RecordingPairingClient implements CompanionClient {
  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  var submitCalls = 0;
  PairingBootstrap? submittedBootstrap;
  String? submittedDeviceName;
  String? submittedPlatform;

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  }) async {
    submitCalls += 1;
    submittedBootstrap = bootstrap;
    submittedDeviceName = deviceName;
    submittedPlatform = platform;
    return PairingSubmissionStatus(
      requestId: 'request-1',
      status: 'pending',
      expiresAt: DateTime.now().add(const Duration(minutes: 1)),
    );
  }

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
    CompanionPairingDiagnostic? onDiagnostic,
  }) async => const PairingPoll(
    status: 'approved',
    deviceId: 'device-1',
    credential: 'credential-1',
  );

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async => CompanionHostConnection(
    endpoint: trustRecord.endpointCandidates.single,
    status: HostStatus(
      hostId: trustRecord.hostId,
      protocolVersion: 2,
      serverTime: DateTime.utc(2026, 8, 4),
    ),
  );

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _MemorySecureStorage implements CompanionSecureStorage {
  CompanionTrustRecord? record;

  @override
  Future<void> forget() async => record = null;

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord value) async => record = value;
}
