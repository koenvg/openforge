import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/live/live_updates_controller.dart';
import 'package:openforge_companion/src/project_board/project_board_controller.dart';
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
  initialPrompt: 'Keep Task detail current while the app is foregrounded.',
  title: 'Foreground live updates',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'doing',
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
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  final connections = <Object>[];
  final cursors = <String?>[];
  var attentionCalls = 0;
  var taskDetailCalls = 0;
  var projectCatalogCalls = 0;
  final List<String> projectBoardRequests = <String>[];
  Completer<ProjectBoard>? pendingProjectBoard;
  Object? attentionError;
  Object? taskDetailError;
  AttentionSnapshot attentionSnapshot = _snapshot;

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
    return attentionSnapshot;
  }

  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) async {
    projectCatalogCalls += 1;
    return ProjectCatalog(
      snapshotAt: DateTime.utc(2026, 8, 1),
      projects: const <ProjectCatalogItem>[
        ProjectCatalogItem(projectId: 'P-1', name: 'OpenForge'),
        ProjectCatalogItem(projectId: 'P-2', name: 'Other'),
      ],
    );
  }

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async {
    projectBoardRequests.add(projectId);
    final pending = pendingProjectBoard;
    if (pending != null) return pending.future;
    return _emptyBoard(projectId, projectId == 'P-1' ? 'OpenForge' : 'Other');
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
  Future<TaskStartResult> startTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) => throw UnsupportedError('not used');

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
    CompanionPairingDiagnostic? onDiagnostic,
  }) => throw UnsupportedError('not used');

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  }) => throw UnsupportedError('not used');
}

final class _FakeStorage implements CompanionProjectStorage {
  CompanionTrustRecord? record = _trustRecord;

  @override
  Future<void> forget() async {}

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord value) async {}

  @override
  Future<String?> loadSelectedProject(String hostId) async => 'P-1';

  @override
  Future<void> saveSelectedProject(String hostId, String projectId) async {}

  @override
  Future<void> clearSelectedProject(String hostId) async {}
}

Future<void> _until(bool Function() predicate) async {
  for (var index = 0; index < 100 && !predicate(); index += 1) {
    await Future<void>.delayed(Duration.zero);
  }
  expect(predicate(), isTrue, reason: 'condition did not become true');
}

ProjectBoard _emptyBoard(String projectId, String projectName) => ProjectBoard(
  snapshotAt: DateTime.utc(2026, 8, 1),
  projectId: projectId,
  projectName: projectName,
  counts: const ProjectBoardCounts(
    focus: 0,
    inFlight: 0,
    outOfFocus: 0,
    backlog: 0,
  ),
  lanes: ProjectBoardLanes(
    focus: const <ProjectBoardTask>[],
    inFlight: const <ProjectBoardTask>[],
    outOfFocus: const <ProjectBoardTask>[],
    backlog: const <ProjectBoardTask>[],
  ),
);
void main() {
  test(
    'Project Board live updates ignore unrelated Projects and recover from gaps',
    () async {
      final connection = _FakeConnection();
      final client = _FakeClient()..connections.add(connection);
      final storage = _FakeStorage();
      final board = ProjectBoardController(client: client, storage: storage);
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        projectBoard: board,
      );

      live.start();
      await _until(
        () =>
            client.projectCatalogCalls == 1 &&
            client.projectBoardRequests.length == 1,
      );
      expect(board.selectedProjectId, 'P-1');

      connection.controller.add(
        const CompanionResourcesInvalidated(
          eventId: 'epoch:1',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.projectBoard('P-2'),
          ],
        ),
      );
      await Future<void>.delayed(Duration.zero);
      await Future<void>.delayed(Duration.zero);
      expect(client.projectBoardRequests, <String>['P-1']);

      connection.controller.add(
        const CompanionResourcesInvalidated(
          eventId: 'epoch:2',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.projectBoard('P-1'),
          ],
        ),
      );
      await _until(() => client.projectBoardRequests.length == 2);
      expect(client.projectCatalogCalls, 1);

      connection.controller.add(
        const CompanionResourcesInvalidated(
          eventId: 'epoch:3',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.projectCatalog(),
          ],
        ),
      );
      await _until(
        () =>
            client.projectCatalogCalls == 2 &&
            client.projectBoardRequests.length == 3,
      );

      final currentSnapshot = board.state;
      final pendingGapBoard = Completer<ProjectBoard>();
      client.pendingProjectBoard = pendingGapBoard;
      connection.controller.add(const CompanionStreamGap(eventId: 'epoch:4'));
      await _until(
        () =>
            client.projectCatalogCalls == 3 &&
            client.projectBoardRequests.length == 4,
      );
      expect(board.state, same(currentSnapshot));
      pendingGapBoard.complete(_emptyBoard('P-1', 'OpenForge'));
      await _until(() => !identical(board.state, currentSnapshot));
      expect(board.state, isA<ProjectBoardLoaded>());

      await live.suspend();
      expect(board.state, isA<ProjectBoardLoaded>());
    },
  );
  test(
    'resource invalidations refetch attention and only the open Task',
    () async {
      final connection = _FakeConnection();
      final client = _FakeClient()..connections.add(connection);
      final storage = _FakeStorage();
      final attention = AttentionController(client: client, storage: storage);
      final catalogInvalidations = <String>[];
      final boardInvalidations = <String>[];
      final detail = TaskDetailController(
        taskId: 'KVG-2947',
        client: client,
        storage: storage,
      );
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
        onProjectCatalogInvalidated: () => catalogInvalidations.add('catalog'),
        onProjectBoardInvalidated: boardInvalidations.add,
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
            CompanionResourceInvalidation.projectCatalog(),
            CompanionResourceInvalidation.projectBoard('P-4'),
            CompanionResourceInvalidation.task('KVG-2947'),
          ],
        ),
      );
      await _until(
        () => client.attentionCalls == 2 && client.taskDetailCalls == 2,
      );
      expect(catalogInvalidations, <String>['catalog']);
      expect(boardInvalidations, <String>['P-4']);

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

      client.attentionSnapshot = AttentionSnapshot(
        snapshotAt: DateTime.utc(2026, 8, 1),
        items: const <AttentionItem>[],
      );
      client.taskDetailError = const CompanionV1Exception(
        statusCode: 404,
        code: 'not_found',
        message: 'Task was not found',
      );
      connection.controller.add(
        const CompanionResourcesInvalidated(
          eventId: 'epoch:3',
          resources: <CompanionResourceInvalidation>[
            CompanionResourceInvalidation.projectCatalog(),
          ],
        ),
      );
      await _until(
        () => client.attentionCalls == 4 && client.taskDetailCalls == 3,
      );
      expect(catalogInvalidations, <String>['catalog', 'catalog']);
      expect((attention.state as AttentionLoaded).snapshot.items, isEmpty);
      expect(detail.state, isA<TaskDetailNotFound>());
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

  test('stream gaps refresh views in place with fresh snapshots', () async {
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
    expect(attention.state, isA<AttentionLoaded>());

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
    'certificate mismatch after reconnect clears the Project Board and stays terminal',
    () async {
      final first = _FakeConnection();
      final client = _FakeClient()
        ..connections.addAll(<Object>[
          first,
          const CompanionCertificateMismatch(),
        ]);
      final storage = _FakeStorage();
      final board = ProjectBoardController(client: client, storage: storage);
      var mismatches = 0;
      var unavailable = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        projectBoard: board,
        delay: (_) async {},
        onCertificateMismatch: () => mismatches += 1,
        onUnavailable: () => unavailable += 1,
      );

      live.start();
      await _until(() => board.state is ProjectBoardLoaded);
      await first.controller.close();
      await _until(() => mismatches == 1);

      expect(board.state, isA<ProjectBoardLoading>());
      expect(board.selectedProjectId, isNull);
      expect(unavailable, 0);
      expect(client.cursors, hasLength(2));
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

  test(
    'authorization loss clears the Project Board through the live boundary',
    () async {
      final connection = _FakeConnection();
      final client = _FakeClient()..connections.add(connection);
      final storage = _FakeStorage();
      final board = ProjectBoardController(client: client, storage: storage);
      var authorizationLosses = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        projectBoard: board,
        onAuthorizationLost: () => authorizationLosses += 1,
      );

      live.start();
      await _until(() => board.state is ProjectBoardLoaded);
      connection.controller.add(const CompanionAuthorizationRevoked());
      await _until(() => authorizationLosses == 1);

      expect(board.state, isA<ProjectBoardLoading>());
      expect(board.selectedProjectId, isNull);
      expect(client.cursors, hasLength(1));
    },
  );
  test(
    'gateway shutdown clears the Project Board before reconnecting',
    () async {
      final first = _FakeConnection();
      final pendingReconnect = Completer<CompanionLiveConnection>();
      final client = _FakeClient()
        ..connections.addAll(<Object>[first, pendingReconnect]);
      final storage = _FakeStorage();
      final board = ProjectBoardController(client: client, storage: storage);
      var reconnecting = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        projectBoard: board,
        delay: (_) async {},
        onReconnecting: () => reconnecting += 1,
      );

      live.start();
      await _until(() => board.state is ProjectBoardLoaded);
      first.controller.add(const CompanionGatewayClosing());
      await _until(() => reconnecting == 1);

      expect(board.state, isA<ProjectBoardLoading>());
      expect(board.selectedProjectId, isNull);
      await live.suspend();
      pendingReconnect.completeError(const SocketException('gateway disabled'));
    },
  );

  for (final scenario in <({String code, String name})>[
    (code: 'unauthenticated', name: 'credential failure'),
    (code: 'incompatible_version', name: 'incompatible protocol'),
  ]) {
    test('${scenario.name} after reconnect clears the Project Board', () async {
      final first = _FakeConnection();
      final client = _FakeClient()
        ..connections.addAll(<Object>[
          first,
          CompanionV1Exception(
            statusCode: scenario.code == 'unauthenticated' ? 401 : 409,
            code: scenario.code,
            message: 'Safe connection failure',
          ),
        ]);
      final storage = _FakeStorage();
      final board = ProjectBoardController(client: client, storage: storage);
      var authorizationLosses = 0;
      var incompatibilities = 0;
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        projectBoard: board,
        delay: (_) async {},
        onAuthorizationLost: () => authorizationLosses += 1,
        onIncompatible: () => incompatibilities += 1,
      );

      live.start();
      await _until(() => board.state is ProjectBoardLoaded);
      await first.controller.close();
      await _until(() => authorizationLosses == 1 || incompatibilities == 1);

      expect(board.state, isA<ProjectBoardLoading>());
      expect(board.selectedProjectId, isNull);
      expect((
        authorizationLosses,
        incompatibilities,
      ), scenario.code == 'unauthenticated' ? (1, 0) : (0, 1));
    });
  }

  test(
    'detaching attention prevents teardown from notifying its old owner',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage();
      final attention = AttentionController(client: client, storage: storage);
      final live = LiveUpdatesController(
        client: client,
        storage: storage,
        attention: attention,
      );

      live.setAttentionController(null);
      attention.dispose();

      await live.suspend();
    },
  );
}
