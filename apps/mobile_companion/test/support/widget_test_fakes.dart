import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

Future<void> openScanner(WidgetTester tester) async {
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

void installScannerPlatform(MobileScannerPlatform platform) {
  final previousPlatform = MobileScannerPlatform.instance;
  MobileScannerPlatform.instance = platform;
  MobileScannerController.resetPlatformSessionOwner();
  addTearDown(() {
    MobileScannerPlatform.instance = previousPlatform;
    MobileScannerController.resetPlatformSessionOwner();
  });
}

class FakeMobileScannerPlatform extends MobileScannerPlatform {
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

final class BlockingStopMobileScannerPlatform
    extends FakeMobileScannerPlatform {
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

final class FailingStopMobileScannerPlatform extends FakeMobileScannerPlatform {
  @override
  Future<void> stop() {
    stopCalls++;
    throw StateError('Native camera stop failed');
  }
}

CompanionPairingController pairingController() => CompanionPairingController(
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

final trustRecord = CompanionTrustRecord(
  hostId: 'host-1',
  certificateSha256: 'AA:BB:CC',
  endpointCandidates: <Uri>[Uri.parse('https://openforge.local:17424')],
  deviceId: 'device-1',
  deviceCredential: 'device-secret',
);

final class MemoryCompanionStorage implements CompanionSecureStorage {
  MemoryCompanionStorage(this.record);

  CompanionTrustRecord? record;

  @override
  Future<void> forget() async => record = null;

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord record) async => this.record = record;
}

final class DomainCompanionClient implements CompanionClient {
  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  @override
  Future<TaskCreateResult> createTask(
    CompanionTrustRecord trustRecord,
    String projectId,
    String initialPrompt,
  ) => throw UnsupportedError('not used');

  @override
  Future<TaskPromptCatalog> fetchTaskPromptCatalog(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) => throw UnsupportedError('not used');

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async => CompanionHostConnection(
    endpoint: trustRecord.endpointCandidates.single,
    status: HostStatus(
      hostId: trustRecord.hostId,
      protocolVersion: 3,
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
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) => throw UnimplementedError();

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) => throw UnimplementedError();
  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => TaskDetail(
    taskId: taskId,
    initialPrompt: 'Handle this sensitive Task.',
    title: 'Sensitive Task',
    projectId: 'P-private',
    projectName: 'Private Project',
    boardStatus: 'doing',
    agentState: 'blocked',
    agentErrorSummary: null,
    createdAt: DateTime.utc(2026, 7, 29),
    updatedAt: DateTime.utc(2026, 7, 30),
    agentUpdatedAt: DateTime.utc(2026, 7, 30),
  );

  @override
  Future<TaskStartResult> startTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnimplementedError();
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
