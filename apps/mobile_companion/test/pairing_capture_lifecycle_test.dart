import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/live/live_updates_controller.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/widget_test_fakes.dart' show installScannerPlatform;

const _hostId = '65d91f21-6732-45a6-9418-3dfaf4c93f52';
const _fingerprint =
    '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A';
const _secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const _tailscaleEndpoint = 'https://desktop.example.ts.net:17424';
const _tailscaleQrPayload =
    '{"protocolVersion":2,"hostId":"$_hostId",'
    '"certificateSha256":"$_fingerprint",'
    '"endpointCandidates":["$_tailscaleEndpoint"],'
    '"oneTimeSecret":"$_secret"}';

void main() {
  testWidgets(
    'QR pairing waits for scanner and name routes to dispose before controller pairing starts',
    (tester) async {
      final scanner = _FakeMobileScannerPlatform(blockDispose: true);
      installScannerPlatform(scanner);
      addTearDown(scanner.completeDispose);
      final client = _SuccessfulPairingClient(waitForApproval: true);
      final storage = _MemorySecureStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final attention = AttentionController(client: client, storage: storage);
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );
      addTearDown(() {
        controller.dispose();
        attention.dispose();
      });
      await controller.forgetAndReset();

      await tester.pumpWidget(
        CompanionApp(
          controller: controller,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );
      await tester.tap(find.byKey(const Key('pair-with-desktop')));
      await tester.pumpAndSettle();

      scanner.addBarcode(
        const BarcodeCapture(
          barcodes: <Barcode>[Barcode(rawValue: _tailscaleQrPayload)],
        ),
      );
      await tester.pump();
      await _pumpUntil(tester, () => scanner.disposeStarted);
      expect(scanner.disposeStarted, isTrue);
      await tester.pump();
      expect(find.text('Name this phone'), findsNothing);
      expect(find.byKey(const Key('pair-with-desktop')), findsNothing);
      expect(find.byKey(const Key('pair-manually')), findsNothing);

      scanner.completeDispose();
      await tester.pumpAndSettle();
      expect(find.text('Name this phone'), findsOneWidget);

      await tester.tap(find.text('Send request'));
      await tester.pump();

      expect(
        client.submitCalls,
        0,
        reason:
            'Pairing must not rebuild the app while the outgoing DialogRoute still owns inherited dependents.',
      );

      await tester.pumpAndSettle();
      expect(client.submitCalls, 1);
      expect(find.text('Awaiting desktop approval'), findsOneWidget);

      client.approve();
      await tester.pumpAndSettle();
      expect(find.text("You're all caught up"), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'manual bootstrap pairing bypasses the scanner and waits for its route to dispose',
    (tester) async {
      final client = _SuccessfulPairingClient();
      final storage = _MemorySecureStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      addTearDown(controller.dispose);
      await controller.forgetAndReset();

      await tester.pumpWidget(CompanionApp(controller: controller));
      await tester.tap(find.byKey(const Key('pair-manually')));
      await tester.pumpAndSettle();

      await tester.enterText(
        find.byKey(const Key('manual-pairing-payload')),
        _tailscaleQrPayload,
      );
      await tester.tap(find.byKey(const Key('submit-manual-pairing')));
      await tester.pump();

      expect(client.submitCalls, 0);

      await tester.pumpAndSettle();
      expect(client.submitCalls, 1);
      expect(find.text('Connected'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'manual pairing surfaces the exact pre-approval submission failure',
    (tester) async {
      final client = _SuccessfulPairingClient(
        submitError: StateError('No route to 100.64.0.7:17424'),
      );
      final controller = CompanionPairingController(
        client: client,
        storage: _MemorySecureStorage(),
        pollInterval: Duration.zero,
      );
      addTearDown(controller.dispose);
      await controller.forgetAndReset();

      await tester.pumpWidget(CompanionApp(controller: controller));
      await tester.tap(find.byKey(const Key('pair-manually')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('manual-pairing-payload')),
        _tailscaleQrPayload,
      );
      await tester.tap(find.byKey(const Key('submit-manual-pairing')));
      await tester.pumpAndSettle();

      expect(find.text('Direct pairing failed'), findsOneWidget);
      expect(
        find.textContaining('gateway request submission failed'),
        findsOneWidget,
      );
      expect(
        find.textContaining('endpoint started: $_tailscaleEndpoint'),
        findsOneWidget,
      );
      expect(
        find.textContaining('endpoint failed: $_tailscaleEndpoint'),
        findsOneWidget,
      );
      expect(
        find.textContaining('No route to 100.64.0.7:17424'),
        findsOneWidget,
      );
      expect(find.textContaining(_secret), findsNothing);

      await tester.tap(find.text('Close'));
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'controller replacement before route disposal cancels manual submission',
    (tester) async {
      final oldClient = _SuccessfulPairingClient();
      final newClient = _SuccessfulPairingClient();
      final oldStorage = _MemorySecureStorage();
      final newStorage = _MemorySecureStorage();
      final oldController = CompanionPairingController(
        client: oldClient,
        storage: oldStorage,
        pollInterval: Duration.zero,
      );
      final newController = CompanionPairingController(
        client: newClient,
        storage: newStorage,
        pollInterval: Duration.zero,
      );
      addTearDown(() {
        oldController.dispose();
        newController.dispose();
      });
      await oldController.forgetAndReset();
      await newController.forgetAndReset();

      await tester.pumpWidget(CompanionApp(controller: oldController));
      await tester.tap(find.byKey(const Key('pair-manually')));
      await tester.pumpAndSettle();

      await tester.pumpWidget(CompanionApp(controller: newController));
      await tester.enterText(
        find.byKey(const Key('manual-pairing-payload')),
        _tailscaleQrPayload,
      );
      await tester.tap(find.byKey(const Key('submit-manual-pairing')));
      await tester.pumpAndSettle();

      expect(oldClient.submitCalls, 0);
      expect(newClient.submitCalls, 0);
      expect(find.text('Not paired'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );

  testWidgets(
    'controller replacement during submission cannot save stale trust',
    (tester) async {
      final oldClient = _SuccessfulPairingClient(blockSubmission: true);
      final newClient = _SuccessfulPairingClient();
      final oldStorage = _MemorySecureStorage();
      final oldController = CompanionPairingController(
        client: oldClient,
        storage: oldStorage,
        pollInterval: Duration.zero,
      );
      final newController = CompanionPairingController(
        client: newClient,
        storage: _MemorySecureStorage(),
        pollInterval: Duration.zero,
      );
      addTearDown(() {
        oldClient.completeSubmission();
        oldController.dispose();
        newController.dispose();
      });
      await oldController.forgetAndReset();
      await newController.forgetAndReset();

      await tester.pumpWidget(CompanionApp(controller: oldController));
      await tester.tap(find.byKey(const Key('pair-manually')));
      await tester.pumpAndSettle();
      await tester.enterText(
        find.byKey(const Key('manual-pairing-payload')),
        _tailscaleQrPayload,
      );
      await tester.tap(find.byKey(const Key('submit-manual-pairing')));
      await _pumpUntil(tester, () => oldClient.submitCalls == 1);

      await tester.pumpWidget(CompanionApp(controller: newController));
      oldClient.completeSubmission();
      await tester.pumpAndSettle();

      expect(oldStorage.record, isNull);
      expect(newClient.submitCalls, 0);
      expect(find.text('Direct pairing failed'), findsNothing);
      expect(find.text('Not paired'), findsOneWidget);
      expect(tester.takeException(), isNull);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
    },
  );
}

Future<void> _pumpUntil(WidgetTester tester, bool Function() condition) async {
  for (var attempt = 0; attempt < 20 && !condition(); attempt++) {
    await tester.pump(const Duration(milliseconds: 50));
  }
  expect(
    condition(),
    isTrue,
    reason: 'Expected lifecycle event did not occur.',
  );
}

final class _FakeMobileScannerPlatform extends MobileScannerPlatform {
  _FakeMobileScannerPlatform({this.blockDispose = false});

  final bool blockDispose;
  final _disposeCompleter = Completer<void>();
  final _barcodes = StreamController<BarcodeCapture>.broadcast();
  var disposeStarted = false;
  var _closed = false;

  void completeDispose() {
    if (!_disposeCompleter.isCompleted) _disposeCompleter.complete();
  }

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
        initialDeviceOrientation: DeviceOrientation.portraitUp,
      );

  @override
  Widget buildCameraView() => const SizedBox.square(dimension: 100);

  void addBarcode(BarcodeCapture barcodeCapture) =>
      _barcodes.add(barcodeCapture);

  @override
  Future<void> stop() async {}

  @override
  Future<void> dispose() async {
    if (_closed) return;
    disposeStarted = true;
    if (blockDispose) await _disposeCompleter.future;
    _closed = true;
    await _barcodes.close();
  }
}

final class _SuccessfulPairingClient implements CompanionClient {
  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  _SuccessfulPairingClient({
    this.waitForApproval = false,
    this.submitError,
    bool blockSubmission = false,
  }) : _submission = blockSubmission
           ? Completer<PairingSubmissionStatus>()
           : null;

  final bool waitForApproval;
  final Object? submitError;
  final _approval = Completer<PairingPoll>();
  final Completer<PairingSubmissionStatus>? _submission;
  var submitCalls = 0;

  void completeSubmission() {
    final submission = _submission;
    if (submission == null || submission.isCompleted) return;
    submission.complete(
      PairingSubmissionStatus(
        requestId: 'request-1',
        status: 'pending',
        expiresAt: DateTime.now().add(const Duration(minutes: 1)),
      ),
    );
  }

  void approve() {
    if (!_approval.isCompleted) {
      _approval.complete(
        const PairingPoll(
          status: 'approved',
          deviceId: 'device-1',
          credential: 'credential-1',
        ),
      );
    }
  }

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  }) async {
    submitCalls += 1;
    final endpoint = bootstrap.endpointCandidates.first;
    onDiagnostic?.call('endpoint started: $endpoint');
    final error = submitError;
    if (error != null) {
      onDiagnostic?.call(
        'endpoint failed: $endpoint — ${error.runtimeType}: $error',
      );
      throw error;
    }
    final submission = _submission;
    if (submission != null) return await submission.future;
    onDiagnostic?.call('endpoint succeeded: $endpoint');
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
  }) {
    if (waitForApproval) return _approval.future;
    return Future<PairingPoll>.value(
      const PairingPoll(
        status: 'approved',
        deviceId: 'device-1',
        credential: 'credential-1',
      ),
    );
  }

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async => CompanionHostConnection(
    endpoint: Uri.parse(_tailscaleEndpoint),
    status: HostStatus(
      hostId: _hostId,
      protocolVersion: 2,
      serverTime: DateTime.utc(2026, 8, 1),
    ),
  );

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async => AttentionSnapshot(
    snapshotAt: DateTime.utc(2026, 8, 1),
    items: const <AttentionItem>[],
  );

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) async => _FakeLiveConnection();

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _FakeLiveConnection implements CompanionLiveConnection {
  final _events = StreamController<CompanionLiveEvent>();
  var _closed = false;

  @override
  Stream<CompanionLiveEvent> get events => _events.stream;

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    await _events.close();
  }
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
