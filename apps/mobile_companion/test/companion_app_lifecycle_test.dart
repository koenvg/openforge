import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/live/live_updates_controller.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

const _hostId = '65d91f21-6732-45a6-9418-3dfaf4c93f52';
const _fingerprint =
    '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A';
const _secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const _tailscaleEndpoint = 'https://desktop.example.ts.net:17424';

String get _tailscaleQrPayload =>
    '{"protocolVersion":1,"hostId":"$_hostId",'
    '"certificateSha256":"$_fingerprint",'
    '"endpointCandidates":["$_tailscaleEndpoint"],'
    '"oneTimeSecret":"$_secret"}';

void main() {
  testWidgets(
    'successful Tailscale pairing releases a replaced attention controller before teardown',
    (tester) async {
      final endpoint = Uri.parse(_tailscaleEndpoint);
      final client = _SuccessfulTailscaleClient(endpoint);
      final storage = _MemorySecureStorage();
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final attention = AttentionController(client: client, storage: storage);
      final replacementAttention = AttentionController(
        client: client,
        storage: storage,
      );
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );
      addTearDown(() {
        pairing.dispose();
        attention.dispose();
        replacementAttention.dispose();
      });

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );

      await pairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Tailscale Android',
        platform: 'android',
      );
      await tester.pumpAndSettle();

      expect(client.connectedEndpoint, endpoint);
      expect(find.text("You're all caught up"), findsOneWidget);

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: replacementAttention,
          liveUpdatesController: live,
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(client.liveConnections, hasLength(2));
      expect(client.liveConnections.first.closed, isTrue);
      expect(find.text("You're all caught up"), findsOneWidget);

      attention.clear();
      await tester.pumpWidget(const SizedBox.shrink());

      attention.clear();
      replacementAttention.clear();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'replacing live updates after Tailscale pairing closes the old lifecycle owner',
    (tester) async {
      final endpoint = Uri.parse(_tailscaleEndpoint);
      final client = _SuccessfulTailscaleClient(endpoint);
      final storage = _MemorySecureStorage();
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final attention = AttentionController(client: client, storage: storage);
      final oldLive = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );
      final newLive = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );
      addTearDown(() {
        pairing.dispose();
        attention.dispose();
      });

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          liveUpdatesController: oldLive,
        ),
      );
      await pairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Tailscale Android',
        platform: 'android',
      );
      await tester.pumpAndSettle();

      expect(client.liveConnections, hasLength(1));
      expect(client.liveConnections.single.closed, isFalse);

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          liveUpdatesController: newLive,
        ),
      );
      await tester.pumpAndSettle();

      expect(client.liveConnections, hasLength(2));
      expect(client.liveConnections.first.closed, isTrue);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(client.liveConnections.last.closed, isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'replacing pairing controllers reconciles the active connection lifecycle',
    (tester) async {
      final endpoint = Uri.parse(_tailscaleEndpoint);
      final client = _SuccessfulTailscaleClient(endpoint);
      final storage = _MemorySecureStorage();
      final connectedPairing = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final revokedPairing = CompanionPairingController(
        client: client,
        storage: storage,
      )..authorizationLost();
      final replacementConnectedPairing = CompanionPairingController(
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
        connectedPairing.dispose();
        revokedPairing.dispose();
        replacementConnectedPairing.dispose();
        attention.dispose();
      });

      await tester.pumpWidget(
        CompanionApp(
          controller: connectedPairing,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );
      await connectedPairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Tailscale Android',
        platform: 'android',
      );
      await tester.pumpAndSettle();
      expect(client.liveConnections, hasLength(1));

      await tester.pumpWidget(
        CompanionApp(
          controller: revokedPairing,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );
      await tester.pump();
      expect(client.liveConnections.single.closed, isTrue);

      await replacementConnectedPairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Replacement Android',
        platform: 'android',
      );
      await tester.pumpWidget(
        CompanionApp(
          controller: replacementConnectedPairing,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(client.liveConnections, hasLength(2));
      expect(client.liveConnections.last.closed, isFalse);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'connected pairing replacement rebinds live callbacks and restarts trust ownership',
    (tester) async {
      final endpoint = Uri.parse(_tailscaleEndpoint);
      final client = _SuccessfulTailscaleClient(endpoint);
      final storage = _MemorySecureStorage();
      final oldPairing = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final newPairing = CompanionPairingController(
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
        oldPairing.dispose();
        newPairing.dispose();
        attention.dispose();
      });

      await tester.pumpWidget(
        CompanionApp(
          controller: oldPairing,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );
      await oldPairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Old Android',
        platform: 'android',
      );
      await tester.pumpAndSettle();
      expect(client.liveConnections, hasLength(1));
      client.liveConnections.single.add(
        const CompanionResourcesInvalidated(
          eventId: 'old-session-cursor',
          resources: <CompanionResourceInvalidation>[],
        ),
      );
      await tester.pump();
      await tester.pump();

      await newPairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'New Android',
        platform: 'android',
      );
      await tester.pumpWidget(
        CompanionApp(
          controller: newPairing,
          attentionController: attention,
          liveUpdatesController: live,
        ),
      );
      await tester.pump();
      await tester.pump();

      expect(client.liveConnections, hasLength(2));
      expect(client.liveConnections.first.closed, isTrue);
      expect(client.liveLastEventIds, <String?>[null, null]);

      client.liveConnections.last.add(const CompanionAuthorizationRevoked());
      await tester.pump();
      await tester.pump();

      expect(oldPairing.state, isA<Connected>());
      expect(newPairing.state, isA<Revoked>());
      expect(find.text('Re-pair required'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
  testWidgets(
    'pairing and controller replacement keep live networking suspended in the background',
    (tester) async {
      final endpoint = Uri.parse(_tailscaleEndpoint);
      final client = _SuccessfulTailscaleClient(endpoint);
      final oldLiveClient = _SuccessfulTailscaleClient(endpoint);
      final newLiveClient = _SuccessfulTailscaleClient(endpoint);
      final storage = _MemorySecureStorage();
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final attention = AttentionController(client: client, storage: storage);
      final oldLive = LiveUpdatesController(
        client: oldLiveClient,
        storage: storage,
        attention: attention,
      );
      final newLive = LiveUpdatesController(
        client: newLiveClient,
        storage: storage,
        attention: attention,
      );
      addTearDown(() {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
        pairing.dispose();
        attention.dispose();
      });

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          liveUpdatesController: oldLive,
        ),
      );
      await pairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Background Android',
        platform: 'android',
      );
      await tester.pump();
      expect(oldLiveClient.liveConnections, isEmpty);
      expect(newLiveClient.liveConnections, isEmpty);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();
      expect(oldLiveClient.liveConnections, hasLength(1));

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(oldLiveClient.liveConnections.single.closed, isTrue);

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          liveUpdatesController: newLive,
        ),
      );
      await tester.pump();
      expect(newLiveClient.liveConnections, isEmpty);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      await tester.pump();
      expect(newLiveClient.liveConnections, hasLength(1));

      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'replacing live updates transfers the open Task detail lifecycle owner',
    (tester) async {
      final endpoint = Uri.parse(_tailscaleEndpoint);
      final client = _SuccessfulTailscaleClient(endpoint)
        ..attentionItems = <AttentionItem>[
          AttentionItem(
            taskId: 'T-1',
            projectId: 'P-1',
            projectName: 'OpenForge',
            title: 'Task one',
            state: 'needs-input',
            reason: 'Agent needs input.',
            activityAt: DateTime.utc(2026, 8, 1),
          ),
        ];
      final storage = _MemorySecureStorage();
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final attention = AttentionController(client: client, storage: storage);
      final oldLive = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );
      final newLive = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );
      addTearDown(() {
        pairing.dispose();
        attention.dispose();
      });

      CompanionApp app(LiveUpdatesController live) => CompanionApp(
        controller: pairing,
        attentionController: attention,
        liveUpdatesController: live,
        taskDetailControllerFactory: (taskId) => TaskDetailController(
          taskId: taskId,
          client: client,
          storage: storage,
        ),
      );

      await tester.pumpWidget(app(oldLive));
      await pairing.pairFromQr(
        qrPayload: _tailscaleQrPayload,
        deviceName: 'Tailscale Android',
        platform: 'android',
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Task one'));
      await tester.pumpAndSettle();
      expect(client.taskDetailCalls, 1);

      await tester.pumpWidget(app(newLive));
      await tester.pump();
      await tester.pump();
      expect(client.liveConnections, hasLength(2));
      expect(client.taskDetailCalls, 2);

      client.liveConnections.last.add(
        const CompanionResourcesInvalidated(
          eventId: 'event-1',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.task('T-1'),
          ],
        ),
      );
      await tester.pump();
      await tester.pump();
      expect(client.taskDetailCalls, 3);

      await tester.pageBack();
      await tester.pumpAndSettle();
      await tester.pumpWidget(const SizedBox.shrink());
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );
}

final class _SuccessfulTailscaleClient implements CompanionClient {
  _SuccessfulTailscaleClient(this.endpoint);

  final Uri endpoint;
  Uri? connectedEndpoint;
  final liveConnections = <_FakeLiveConnection>[];
  final liveLastEventIds = <String?>[];
  List<AttentionItem> attentionItems = const <AttentionItem>[];
  var taskDetailCalls = 0;

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  }) async => PairingSubmissionStatus(
    requestId: 'request-1',
    status: 'pending',
    expiresAt: DateTime.now().add(const Duration(minutes: 1)),
  );

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
  }) async => const PairingPoll(
    status: 'approved',
    deviceId: 'device-1',
    credential: 'credential-1',
  );

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async {
    connectedEndpoint = trustRecord.endpointCandidates.single;
    return CompanionHostConnection(
      endpoint: endpoint,
      status: HostStatus(
        hostId: _hostId,
        protocolVersion: 1,
        serverTime: DateTime.utc(2026, 8, 1),
      ),
    );
  }

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async => AttentionSnapshot(
    snapshotAt: DateTime.utc(2026, 8, 1),
    items: attentionItems,
  );

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    taskDetailCalls += 1;
    return TaskDetail(
      taskId: taskId,
      title: 'Task one',
      projectId: 'P-1',
      projectName: 'OpenForge',
      boardStatus: 'doing',
      handoffNotes: 'Ready for review.',
      agentState: 'needs-input',
      agentErrorSummary: null,
      createdAt: DateTime.utc(2026, 8, 1),
      updatedAt: DateTime.utc(2026, 8, 1),
      agentUpdatedAt: null,
    );
  }

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) async {
    final connection = _FakeLiveConnection();
    liveConnections.add(connection);
    liveLastEventIds.add(lastEventId);
    return connection;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _FakeLiveConnection implements CompanionLiveConnection {
  final _events = StreamController<CompanionLiveEvent>();
  var closed = false;

  @override
  Stream<CompanionLiveEvent> get events => _events.stream;

  void add(CompanionLiveEvent event) => _events.add(event);

  @override
  Future<void> close() async {
    if (closed) return;
    closed = true;
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
