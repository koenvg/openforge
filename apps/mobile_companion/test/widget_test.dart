import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/attention/attention_home.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

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
    'replacing the pairing controller transfers state subscription ownership',
    (tester) async {
      final oldController = _pairingController();
      final newController = _pairingController()..liveUnavailable();

      await tester.pumpWidget(CompanionApp(controller: oldController));
      expect(find.text('Restoring connection'), findsOneWidget);

      await tester.pumpWidget(CompanionApp(controller: newController));
      expect(find.text('Desktop unavailable'), findsOneWidget);

      newController.authorizationLost();
      await tester.pump();
      expect(find.text('Re-pair required'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      oldController.liveUnavailable();
      expect(tester.takeException(), isNull);

      oldController.dispose();
      newController.dispose();
    },
  );

  testWidgets(
    'connected state displays authenticated host identity and protocol',
    (tester) async {
      await tester.pumpWidget(
        const CompanionApp(
          initialState: Connected(hostId: 'desktop-host-1', protocolVersion: 1),
        ),
      );

      expect(find.text('Connected'), findsOneWidget);
      expect(
        find.textContaining('Interactive Agent terminal access is active'),
        findsOneWidget,
      );
      expect(find.text('Host desktop-host-1'), findsOneWidget);
      expect(find.text('Companion protocol v1'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Connection state: Connected'),
        findsOneWidget,
      );
    },
  );

  testWidgets('stops the camera before removing the scanner route', (
    tester,
  ) async {
    final platform = _BlockingStopMobileScannerPlatform();
    _installScannerPlatform(platform);
    addTearDown(platform.completeStop);

    await _openScanner(tester);

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
    final platform = _FakeMobileScannerPlatform();
    _installScannerPlatform(platform);

    await _openScanner(tester);
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
    final platform = _FailingStopMobileScannerPlatform();
    _installScannerPlatform(platform);

    await _openScanner(tester);

    platform.addBarcode(
      const BarcodeCapture(
        barcodes: <Barcode>[Barcode(rawValue: 'openforge-pairing-payload')],
      ),
    );
    await tester.pumpAndSettle();

    expect(platform.stopCalls, 1);
    expect(find.byType(CompanionQrScannerScreen), findsNothing);
  });

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

  testWidgets('incompatible state retries after the user updates either app', (
    tester,
  ) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const IncompatibleProtocol(),
          onRetry: () => retried = true,
        ),
      ),
    );

    await tester.tap(find.text('Check again'));

    expect(retried, isTrue);
  });

  testWidgets('local network denial opens app settings recovery', (
    tester,
  ) async {
    var openedSettings = false;
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const LocalNetworkPermissionDenied(),
          onOpenSettings: () => openedSettings = true,
          onRetry: () => retried = true,
        ),
      ),
    );

    await tester.tap(find.text('Open settings'));
    await tester.tap(find.text('Retry'));

    expect(openedSettings, isTrue);
    expect(retried, isTrue);
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
    (
      state: const LocalNetworkPermissionDenied(),
      title: 'Local network access needed',
    ),
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
    final scannerPlatform = _FakeMobileScannerPlatform();
    _installScannerPlatform(scannerPlatform);
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

  testWidgets(
    'losing the desktop removes an open Task and its domain content',
    (tester) async {
      final storage = _MemoryCompanionStorage(_trustRecord);
      final client = _DomainCompanionClient();
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
      );
      final attention = AttentionController(client: client, storage: storage);
      await pairing.restore();
      await attention.refresh();

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          taskDetailControllerFactory: (taskId) => TaskDetailController(
            taskId: taskId,
            client: client,
            storage: storage,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sensitive Task'));
      await tester.pumpAndSettle();
      expect(find.text('Private Handoff Notes'), findsOneWidget);

      pairing.liveUnavailable();
      await tester.pumpAndSettle();

      expect(find.text('Desktop unavailable'), findsOneWidget);
      expect(find.text('Sensitive Task'), findsNothing);
      expect(find.text('Private Handoff Notes'), findsNothing);
    },
  );
}

Future<void> _openScanner(WidgetTester tester) async {
  await tester.pumpWidget(
    MaterialApp(
      home: Builder(
        builder: (context) => Scaffold(
          body: TextButton(
            onPressed: () {
              unawaited(
                Navigator.of(context).push<String>(
                  MaterialPageRoute<String>(
                    builder: (_) => const CompanionQrScannerScreen(),
                  ),
                ),
              );
            },
            child: const Text('Open scanner'),
          ),
        ),
      ),
    ),
  );

  await tester.tap(find.text('Open scanner'));
  await tester.pumpAndSettle();
}

void _installScannerPlatform(MobileScannerPlatform platform) {
  final previousPlatform = MobileScannerPlatform.instance;
  MobileScannerPlatform.instance = platform;
  MobileScannerController.resetPlatformSessionOwner();
  addTearDown(() {
    MobileScannerPlatform.instance = previousPlatform;
    MobileScannerController.resetPlatformSessionOwner();
  });
}

class _FakeMobileScannerPlatform extends MobileScannerPlatform {
  final StreamController<BarcodeCapture> _barcodes =
      StreamController<BarcodeCapture>.broadcast();
  bool _closed = false;

  int startCalls = 0;
  int stopCalls = 0;

  @override
  Stream<BarcodeCapture?> get barcodesStream => _barcodes.stream;

  @override
  Stream<TorchState> get torchStateStream =>
      Stream<TorchState>.value(TorchState.unavailable);

  @override
  Stream<double> get zoomScaleStateStream => Stream<double>.value(1);

  @override
  Future<MobileScannerViewAttributes> start(StartOptions startOptions) async {
    startCalls++;
    return const MobileScannerViewAttributes(
      cameraDirection: CameraFacing.back,
      currentTorchMode: TorchState.unavailable,
      size: Size(200, 200),
      numberOfCameras: 1,
      initialDeviceOrientation: DeviceOrientation.portraitUp,
    );
  }

  @override
  Widget buildCameraView() => const SizedBox.square(dimension: 100);

  void addBarcode(BarcodeCapture barcodeCapture) {
    _barcodes.add(barcodeCapture);
  }

  @override
  Future<void> stop() async {
    stopCalls++;
  }

  @override
  Future<void> dispose() => close();

  Future<void> close() {
    if (_closed) return Future<void>.value();
    _closed = true;
    return _barcodes.close();
  }
}

final class _BlockingStopMobileScannerPlatform
    extends _FakeMobileScannerPlatform {
  final Completer<void> _stopCompleter = Completer<void>();

  bool get stopStarted => stopCalls > 0;

  @override
  Future<void> stop() {
    stopCalls++;
    return _stopCompleter.future;
  }

  void completeStop() {
    if (!_stopCompleter.isCompleted) _stopCompleter.complete();
  }
}

final class _FailingStopMobileScannerPlatform
    extends _FakeMobileScannerPlatform {
  @override
  Future<void> stop() {
    stopCalls++;
    throw StateError('Native camera stop failed');
  }
}

CompanionPairingController _pairingController() => CompanionPairingController(
  client: _UnusedCompanionClient(),
  storage: _UnusedCompanionSecureStorage(),
);

final class _UnusedCompanionClient implements CompanionClient {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _UnusedCompanionSecureStorage implements CompanionSecureStorage {
  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Storage method was not expected.');
}

final _trustRecord = CompanionTrustRecord(
  hostId: 'host-1',
  certificateSha256: 'AA:BB:CC',
  endpointCandidates: <Uri>[Uri.parse('https://openforge.local:17424')],
  deviceId: 'device-1',
  deviceCredential: 'device-secret',
);

final class _MemoryCompanionStorage implements CompanionSecureStorage {
  _MemoryCompanionStorage(this.record);

  CompanionTrustRecord? record;

  @override
  Future<void> forget() async => record = null;

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord record) async => this.record = record;
}

final class _DomainCompanionClient implements CompanionClient {
  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async => CompanionHostConnection(
    endpoint: trustRecord.endpointCandidates.single,
    status: HostStatus(
      hostId: trustRecord.hostId,
      protocolVersion: 1,
      serverTime: DateTime.utc(2026, 7, 30),
    ),
  );

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async => AttentionSnapshot(
    snapshotAt: DateTime.utc(2026, 7, 30, 12),
    items: <AttentionItem>[
      AttentionItem(
        taskId: 'T-private',
        projectId: 'P-private',
        projectName: 'Private Project',
        title: 'Sensitive Task',
        state: 'blocked',
        reason: 'Needs input',
        activityAt: DateTime.utc(2026, 7, 30, 11),
      ),
    ],
  );

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => TaskDetail(
    taskId: taskId,
    title: 'Sensitive Task',
    projectId: 'P-private',
    projectName: 'Private Project',
    boardStatus: 'doing',
    handoffNotes: 'Private Handoff Notes',
    agentState: 'blocked',
    agentErrorSummary: null,
    createdAt: DateTime.utc(2026, 7, 29),
    updatedAt: DateTime.utc(2026, 7, 30),
    agentUpdatedAt: DateTime.utc(2026, 7, 30),
  );

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) => throw UnimplementedError();

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
    CompanionPairingDiagnostic? onDiagnostic,
  }) => throw UnimplementedError();

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  }) => throw UnimplementedError();
}
