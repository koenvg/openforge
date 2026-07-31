import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/live/live_updates_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

final _trustRecord = CompanionTrustRecord(
  hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
  certificateSha256: 'trusted-pin',
  endpointCandidates: <Uri>[Uri.parse('https://192.168.1.20:17424')],
  deviceId: '50b26936-55a7-48e5-a1c7-65eaf08211ee',
  deviceCredential: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
);

final _snapshot = AttentionSnapshot(
  snapshotAt: DateTime.utc(2026, 7, 31, 12),
  items: const <AttentionItem>[],
);

final _detail = TaskDetail(
  taskId: 'KVG-2947',
  title: 'Foreground live updates',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'doing',
  handoffNotes: null,
  agentState: 'running',
  agentErrorSummary: null,
  createdAt: DateTime.utc(2026, 7, 31, 10),
  updatedAt: DateTime.utc(2026, 7, 31, 11),
  agentUpdatedAt: DateTime.utc(2026, 7, 31, 12),
);

final class _FakeConnection implements CompanionLiveConnection {
  final controller = StreamController<CompanionLiveEvent>();
  var closeCalls = 0;
  Completer<void>? closeCompleter;

  @override
  Stream<CompanionLiveEvent> get events => controller.stream;

  @override
  Future<void> close() async {
    closeCalls += 1;
    await closeCompleter?.future;
    if (!controller.isClosed) unawaited(controller.close());
  }
}

final class _FakeClient implements CompanionClient {
  final connections = <Object>[];
  final cursors = <String?>[];
  var attentionCalls = 0;
  var taskDetailCalls = 0;
  Object? attentionError;
  Object? taskDetailError;

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) async {
    cursors.add(lastEventId);
    final outcome = connections.removeAt(0);
    if (outcome is CompanionLiveConnection) return outcome;
    if (outcome is Completer<CompanionLiveConnection>) return outcome.future;
    throw outcome;
  }

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async {
    attentionCalls += 1;
    final error = attentionError;
    if (error != null) throw error;
    return _snapshot;
  }

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    taskDetailCalls += 1;
    final error = taskDetailError;
    if (error != null) throw error;
    return _detail;
  }

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) => throw UnsupportedError('not used');

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
  }) => throw UnsupportedError('not used');

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  }) => throw UnsupportedError('not used');
}

final class _FakeStorage implements CompanionSecureStorage {
  CompanionTrustRecord? record = _trustRecord;

  @override
  Future<void> forget() async {}

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord value) async {}
}

Future<void> _until(bool Function() predicate) async {
  for (var index = 0; index < 100 && !predicate(); index += 1) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(predicate(), isTrue, reason: 'condition did not become true');
}

void main() {
  test(
    'resource invalidations refetch attention and only the open Task',
    () async {
      final connection = _FakeConnection();
      final client = _FakeClient()..connections.add(connection);
      final storage = _FakeStorage();
      final attention = AttentionController(client: client, storage: storage);
      final detail = TaskDetailController(
        taskId: 'KVG-2947',
        client: client,
        storage: storage,
      );
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      )..setOpenTask(detail);

      live.start();
      await _until(
        () => client.attentionCalls == 1 && client.taskDetailCalls == 1,
      );
      connection.controller.add(
        const CompanionResourcesInvalidated(
          eventId: 'epoch:1',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.attention(),
            CompanionResourceInvalidation.task('KVG-2947'),
          ],
        ),
      );
      await _until(
        () => client.attentionCalls == 2 && client.taskDetailCalls == 2,
      );

      connection.controller.add(
        const CompanionResourcesInvalidated(
          eventId: 'epoch:2',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.attention(),
            CompanionResourceInvalidation.task('KVG-OTHER'),
          ],
        ),
      );
      await _until(() => client.attentionCalls == 3);
      expect(client.taskDetailCalls, 2);
      await live.suspend();
    },
  );

  test('cursor resume reconnects with bounded exponential delay', () async {
    final first = _FakeConnection();
    final second = _FakeConnection();
    final client = _FakeClient()..connections.addAll(<Object>[first, second]);
    final delays = <Duration>[];
    final live = LiveUpdatesController(
      client: client,
      storage: _FakeStorage(),
      attention: AttentionController(client: client, storage: _FakeStorage()),
      delay: (duration) async => delays.add(duration),
      reconnectBaseDelay: const Duration(seconds: 1),
      reconnectMaxDelay: const Duration(seconds: 4),
    );

    live.start();
    await _until(() => client.cursors.length == 1);
    first.controller.add(
      const CompanionResourcesInvalidated(
        eventId: 'epoch:7',
        resources: <CompanionResourceInvalidation>[
          CompanionResourceInvalidation.attention(),
        ],
      ),
    );
    await _until(() => client.attentionCalls >= 2);
    await first.controller.close();
    await _until(() => client.cursors.length == 2);

    expect(client.cursors, <String?>[null, 'epoch:7']);
    expect(delays, <Duration>[const Duration(seconds: 1)]);
    await live.suspend();
  });

  test('stream gaps discard views and obtain fresh snapshots', () async {
    final connection = _FakeConnection();
    final client = _FakeClient()..connections.add(connection);
    final storage = _FakeStorage();
    final attention = AttentionController(client: client, storage: storage);
    final detail = TaskDetailController(
      taskId: 'KVG-2947',
      client: client,
      storage: storage,
    );
    final live = LiveUpdatesController(
      client: client,
      storage: storage,
      attention: attention,
    )..setOpenTask(detail);

    live.start();
    await _until(
      () => client.attentionCalls == 1 && client.taskDetailCalls == 1,
    );
    connection.controller.add(const CompanionStreamGap(eventId: 'epoch:9'));
    await _until(
      () => client.attentionCalls == 2 && client.taskDetailCalls == 2,
    );
    await live.suspend();
  });

  test('reconnect attempts stop at the configured bound', () async {
    final client = _FakeClient()
      ..connections.addAll(
        List<Object>.filled(4, const SocketException('offline')),
      );
    final delays = <Duration>[];
    var unavailable = 0;
    final live = LiveUpdatesController(
      client: client,
      storage: _FakeStorage(),
      attention: AttentionController(client: client, storage: _FakeStorage()),
      maxReconnectAttempts: 3,
      reconnectBaseDelay: const Duration(seconds: 1),
      reconnectMaxDelay: const Duration(seconds: 4),
      delay: (duration) async => delays.add(duration),
      onUnavailable: () => unavailable += 1,
    );

    live.start();
    await _until(() => unavailable == 1);

    expect(client.cursors, hasLength(4));
    expect(delays, <Duration>[
      const Duration(seconds: 1),
      const Duration(seconds: 2),
      const Duration(seconds: 4),
    ]);
  });

  test('slow snapshot failures still consume the reconnect bound', () async {
    final client = _FakeClient()
      ..connections.addAll(<Object>[
        _FakeConnection(),
        _FakeConnection(),
        _FakeConnection(),
      ])
      ..attentionError = const SocketException('snapshot timeout');
    var unavailable = 0;
    final live = LiveUpdatesController(
      client: client,
      storage: _FakeStorage(),
      attention: AttentionController(client: client, storage: _FakeStorage()),
      maxReconnectAttempts: 2,
      reconnectStabilityWindow: Duration.zero,
      delay: (_) async {},
      onUnavailable: () => unavailable += 1,
    );

    live.start();
    await _until(() => unavailable == 1);

    expect(client.cursors, hasLength(3));
  });

  test('resume cannot be cleared by an older pending suspension', () async {
    final first = _FakeConnection()..closeCompleter = Completer<void>();
    final second = _FakeConnection();
    final client = _FakeClient()..connections.addAll(<Object>[first, second]);
    final storage = _FakeStorage();
    final attention = AttentionController(client: client, storage: storage);
    var connectedTransitions = 0;
    final live = LiveUpdatesController(
      client: client,
      storage: storage,
      attention: attention,
      onConnected: () => connectedTransitions += 1,
    );

    live.start();
    await _until(() => client.attentionCalls == 1);
    final suspension = live.suspend();
    await _until(() => first.closeCalls == 1);
    expect(attention.state, isA<AttentionLoading>());

    live.resume();
    await _until(
      () =>
          client.attentionCalls == 2 &&
          client.cursors.length == 2 &&
          connectedTransitions == 2,
    );
    expect(connectedTransitions, 2);
    first.closeCompleter!.complete();
    await suspension;
    expect(attention.state, isA<AttentionLoaded>());
    await live.suspend();
  });
  test(
    'certificate mismatch is terminal and keeps its security state',
    () async {
      final client = _FakeClient()
        ..connections.add(const CompanionCertificateMismatch());
      var mismatches = 0;
      var unavailable = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: _FakeStorage(),
        attention: AttentionController(client: client, storage: _FakeStorage()),
        onCertificateMismatch: () => mismatches += 1,
        onUnavailable: () => unavailable += 1,
      );

      live.start();
      await _until(() => mismatches == 1);

      expect(unavailable, 0);
      expect(client.cursors, hasLength(1));
    },
  );

  test('stale terminal result cannot replace a resumed connection', () async {
    final stale = Completer<CompanionLiveConnection>();
    final resumed = _FakeConnection();
    final client = _FakeClient()..connections.addAll(<Object>[stale, resumed]);
    final storage = _FakeStorage();
    final attention = AttentionController(client: client, storage: storage);
    var mismatches = 0;
    final live = LiveUpdatesController(
      client: client,
      storage: storage,
      attention: attention,
      onCertificateMismatch: () => mismatches += 1,
    );

    live.start();
    await _until(() => client.cursors.length == 1);
    await live.suspend();
    live.resume();
    await _until(() => client.attentionCalls == 1);
    stale.completeError(const CompanionCertificateMismatch());
    await Future<void>.delayed(Duration.zero);

    expect(mismatches, 0);
    expect(attention.state, isA<AttentionLoaded>());
    expect(resumed.closeCalls, 0);
    await live.suspend();
  });

  test(
    'initial snapshot failure enters the bounded unavailable state',
    () async {
      final connection = _FakeConnection();
      final client = _FakeClient()
        ..connections.add(connection)
        ..attentionError = const SocketException('snapshot offline');
      var unavailable = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: _FakeStorage(),
        attention: AttentionController(client: client, storage: _FakeStorage()),
        maxReconnectAttempts: 0,
        onUnavailable: () => unavailable += 1,
      );

      live.start();
      await _until(() => unavailable == 1);

      expect(connection.closeCalls, 1);
    },
  );

  test('gap snapshot failure leaves no connected stale view', () async {
    final connection = _FakeConnection();
    final client = _FakeClient()..connections.add(connection);
    var unavailable = 0;
    final live = LiveUpdatesController(
      client: client,
      storage: _FakeStorage(),
      attention: AttentionController(client: client, storage: _FakeStorage()),
      maxReconnectAttempts: 0,
      onUnavailable: () => unavailable += 1,
    );

    live.start();
    await _until(() => client.attentionCalls == 1);
    client.attentionError = const SocketException('snapshot offline');
    connection.controller.add(const CompanionStreamGap(eventId: 'epoch:12'));
    await _until(() => unavailable == 1);

    expect(client.attentionCalls, 2);
  });

  test(
    'resume snapshot failure enters unavailable instead of connected',
    () async {
      final first = _FakeConnection();
      final second = _FakeConnection();
      final client = _FakeClient()..connections.addAll(<Object>[first, second]);
      var unavailable = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: _FakeStorage(),
        attention: AttentionController(client: client, storage: _FakeStorage()),
        maxReconnectAttempts: 0,
        onUnavailable: () => unavailable += 1,
      );

      live.start();
      await _until(() => client.attentionCalls == 1);
      await live.suspend();
      client.attentionError = const SocketException('snapshot offline');
      live.resume();
      await _until(() => unavailable == 1);

      expect(client.attentionCalls, 2);
    },
  );

  test('authorization termination crosses the typed client boundary', () async {
    final connection = _FakeConnection();
    final client = _FakeClient()..connections.add(connection);
    var authorizationLosses = 0;
    final live = LiveUpdatesController(
      client: client,
      storage: _FakeStorage(),
      attention: AttentionController(client: client, storage: _FakeStorage()),
      onAuthorizationLost: () => authorizationLosses += 1,
    );

    live.start();
    await _until(() => client.cursors.length == 1);
    connection.controller.add(const CompanionAuthorizationRevoked());
    await _until(() => authorizationLosses == 1);

    expect(client.cursors, hasLength(1));
  });
}
