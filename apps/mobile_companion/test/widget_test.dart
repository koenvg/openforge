import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/attention/attention_home.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';

void main() {
  testWidgets('launches into an accessible unpaired screen', (tester) async {
    await tester.pumpWidget(const CompanionApp());

    expect(find.text('Not paired'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Connection state: Not paired'),
      findsOneWidget,
    );
  });

  testWidgets(
    'connected state displays authenticated host identity and protocol',
    (tester) async {
      await tester.pumpWidget(
        const CompanionApp(
          initialState: Connected(hostId: 'desktop-host-1', protocolVersion: 1),
        ),
      );

      expect(find.text('Connected'), findsOneWidget);
      expect(find.text('Host desktop-host-1'), findsOneWidget);
      expect(find.text('Companion protocol v1'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Connection state: Connected'),
        findsOneWidget,
      );
    },
  );

  testWidgets('revoked state exposes a re-pair recovery action', (
    tester,
  ) async {
    var reset = false;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const Revoked(),
          onReset: () => reset = true,
        ),
      ),
    );

    await tester.tap(find.text('Forget and pair again'));
    expect(reset, isTrue);
  });

  for (final scenario in <({CompanionConnectionState state, String title})>[
    (state: const Restoring(), title: 'Restoring connection'),
    (state: const Unpaired(), title: 'Not paired'),
    (state: const Pairing(), title: 'Pairing'),
    (state: const AwaitingApproval(), title: 'Awaiting desktop approval'),
    (state: const PairingRejected(), title: 'Pairing rejected'),
    (state: const PairingUnavailable(), title: 'Pairing unavailable'),
    (
      state: const Connected(hostId: 'desktop-host-1', protocolVersion: 1),
      title: 'Connected',
    ),
    (state: const Reconnecting(), title: 'Reconnecting'),
    (state: const Unavailable(), title: 'Desktop unavailable'),
    (state: const Revoked(), title: 'Re-pair required'),
    (state: const CertificateMismatch(), title: 'Certificate mismatch'),
    (state: const IncompatibleProtocol(), title: 'Update required'),
  ]) {
    testWidgets('${scenario.title} has a distinct semantic connection state', (
      tester,
    ) async {
      await tester.pumpWidget(CompanionApp(initialState: scenario.state));

      expect(find.text(scenario.title), findsOneWidget);
      expect(
        find.bySemanticsLabel('Connection state: ${scenario.title}'),
        findsOneWidget,
      );
    });
  }

  testWidgets('QR scanner returns the first detected non-null payload', (
    tester,
  ) async {
    final previousPlatform = MobileScannerPlatform.instance;
    final scannerPlatform = _FakeMobileScannerPlatform();
    MobileScannerPlatform.instance = scannerPlatform;
    addTearDown(() async {
      MobileScannerPlatform.instance = previousPlatform;
      await scannerPlatform.close();
    });

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

  testWidgets('attention home groups minimal Task context by Project', (
    tester,
  ) async {
    final snapshot = AttentionSnapshot(
      snapshotAt: DateTime.utc(2026, 7, 30, 12),
      items: <AttentionItem>[
        AttentionItem(
          taskId: 'T-2',
          projectId: 'P-1',
          projectName: 'Alpha',
          title: 'Review agent question',
          state: 'needs-input',
          reason: 'Agent needs your input to continue.',
          activityAt: DateTime.utc(2026, 7, 30, 11, 59),
        ),
        AttentionItem(
          taskId: 'T-3',
          projectId: 'P-2',
          projectName: 'Beta',
          title: 'Inspect failed change',
          state: 'failed',
          reason: 'Agent failed — check the error log.',
          activityAt: DateTime.utc(2026, 7, 30, 11, 58),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: AttentionHome(
          state: AttentionLoaded(snapshot),
          onRefresh: () async {},
        ),
      ),
    );

    expect(find.text('Alpha'), findsOneWidget);
    expect(find.text('Beta'), findsOneWidget);
    expect(find.text('Review agent question'), findsOneWidget);
    expect(find.text('Needs input'), findsOneWidget);
    expect(find.text('Agent needs your input to continue.'), findsOneWidget);
    final taskSemantics = find.bySemanticsLabel(
      RegExp(
        r'^Task Review agent question, Needs input, Agent needs your input to continue\.,',
      ),
    );
    expect(taskSemantics, findsOneWidget);
    expect(tester.getSemantics(taskSemantics).label, contains('Jul 30'));
  });

  testWidgets(
    'attention home exposes accessible loading and calm empty states',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: AttentionHome(
            state: const AttentionLoading(),
            onRefresh: () async {},
          ),
        ),
      );
      expect(
        find.bySemanticsLabel('Loading Tasks that need attention'),
        findsOneWidget,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: AttentionHome(
            state: AttentionLoaded(
              AttentionSnapshot(
                snapshotAt: DateTime.utc(2026, 7, 30),
                items: const <AttentionItem>[],
              ),
            ),
            onRefresh: () async {},
          ),
        ),
      );
      expect(find.text("You're all caught up"), findsOneWidget);
      expect(find.text('No Tasks need your attention.'), findsOneWidget);
    },
  );

  testWidgets('attention refresh and error recovery request a fresh snapshot', (
    tester,
  ) async {
    var refreshes = 0;
    Future<void> refresh() async => refreshes += 1;

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(splashFactory: NoSplash.splashFactory),
        home: AttentionHome(
          state: const AttentionLoadError(
            'Current attention could not be loaded.',
          ),
          onRefresh: refresh,
        ),
      ),
    );
    expect(find.text('Couldn’t refresh'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pump();
    expect(refreshes, 1);

    await tester.tap(find.byTooltip('Refresh attention'));
    await tester.pump();
    expect(refreshes, 2);
  });
}

final class _FakeMobileScannerPlatform extends MobileScannerPlatform {
  final StreamController<BarcodeCapture> _barcodes =
      StreamController<BarcodeCapture>.broadcast();

  @override
  Stream<BarcodeCapture?> get barcodesStream => _barcodes.stream;

  @override
  Stream<TorchState> get torchStateStream =>
      Stream<TorchState>.value(TorchState.unavailable);

  @override
  Stream<double> get zoomScaleStateStream => Stream<double>.value(1);

  @override
  Future<MobileScannerViewAttributes> start(StartOptions startOptions) async =>
      const MobileScannerViewAttributes(
        cameraDirection: CameraFacing.back,
        currentTorchMode: TorchState.unavailable,
        size: Size(200, 200),
        numberOfCameras: 1,
      );

  @override
  Widget buildCameraView() => const SizedBox.square(dimension: 100);

  void addBarcode(BarcodeCapture capture) => _barcodes.add(capture);

  Future<void> close() => _barcodes.close();
}
