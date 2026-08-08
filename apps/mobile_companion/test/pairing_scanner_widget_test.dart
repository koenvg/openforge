import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:openforge_companion/src/app.dart';

import 'support/widget_test_fakes.dart';

void main() {
  testWidgets('stops the camera before removing the scanner route', (
    tester,
  ) async {
    final platform = BlockingStopMobileScannerPlatform();
    installScannerPlatform(platform);
    addTearDown(platform.completeStop);

    await openScanner(tester);

    platform.addBarcode(
      const BarcodeCapture(
        barcodes: <Barcode>[Barcode(rawValue: 'openforge-pairing-payload')],
      ),
    );
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));

    expect(platform.stopStarted, isTrue);
    expect(find.byType(CompanionQrScannerScreen), findsOneWidget);

    platform.completeStop();
    await tester.pumpAndSettle();

    expect(find.byType(CompanionQrScannerScreen), findsNothing);
  });

  testWidgets('pauses and resumes the route-owned scanner with the app', (
    tester,
  ) async {
    final platform = FakeMobileScannerPlatform();
    installScannerPlatform(platform);

    await openScanner(tester);
    expect(platform.startCalls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
    await tester.pump();
    expect(platform.stopCalls, 1);

    tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pump();
    expect(platform.startCalls, 2);

    await tester.pumpWidget(const SizedBox.shrink());
    await tester.pumpAndSettle();
  });

  testWidgets('closes the scanner route when native camera stop fails', (
    tester,
  ) async {
    final platform = FailingStopMobileScannerPlatform();
    installScannerPlatform(platform);

    await openScanner(tester);

    platform.addBarcode(
      const BarcodeCapture(
        barcodes: <Barcode>[Barcode(rawValue: 'openforge-pairing-payload')],
      ),
    );
    await tester.pumpAndSettle();

    expect(platform.stopCalls, 1);
    expect(find.byType(CompanionQrScannerScreen), findsNothing);
  });

  testWidgets('QR scanner returns the first detected non-null payload', (
    tester,
  ) async {
    final scannerPlatform = FakeMobileScannerPlatform();
    installScannerPlatform(scannerPlatform);
    addTearDown(scannerPlatform.close);

    late BuildContext launcherContext;
    String? scannedPayload;
    await tester.pumpWidget(
      MaterialApp(
        home: Builder(
          builder: (context) {
            launcherContext = context;
            return const Scaffold(body: Text('Pairing launcher'));
          },
        ),
      ),
    );

    final scan = Navigator.of(launcherContext).push<String>(
      MaterialPageRoute<String>(
        builder: (_) => const CompanionQrScannerScreen(),
      ),
    );
    await tester.pumpAndSettle();

    scannerPlatform.addBarcode(const BarcodeCapture());
    await tester.pump();
    expect(find.text('Scan desktop QR'), findsOneWidget);

    scannerPlatform.addBarcode(
      const BarcodeCapture(
        barcodes: <Barcode>[
          Barcode(format: BarcodeFormat.qrCode),
          Barcode(
            format: BarcodeFormat.qrCode,
            rawValue: 'openforge-pairing-payload',
          ),
        ],
      ),
    );
    scannedPayload = await scan;
    await tester.pumpAndSettle();

    expect(scannedPayload, 'openforge-pairing-payload');
    expect(find.text('Pairing launcher'), findsOneWidget);
  });
}
