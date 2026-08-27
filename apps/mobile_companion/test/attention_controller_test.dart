import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/companion_refresh_outcome.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

final _trustRecord = CompanionTrustRecord(
  hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
  certificateSha256:
      '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A',
  endpointCandidates: <Uri>[Uri.parse('https://192.168.1.20:17424')],
  deviceId: '50b26936-55a7-48e5-a1c7-65eaf08211ee',
  deviceCredential: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
);

AttentionItem _item({
  required String taskId,
  required String projectId,
  required String projectName,
  required int minute,
}) => AttentionItem(
  taskId: taskId,
  projectId: projectId,
  projectName: projectName,
  title: 'Task $taskId',
  state: 'needs-input',
  reason: 'Agent needs your input to continue.',
  activityAt: DateTime.utc(2026, 7, 30, 12, minute),
);

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
  var snapshots = <AttentionSnapshot>[];
  final pendingSnapshots = <Completer<AttentionSnapshot>>[];
  Object? error;
  var attentionCalls = 0;

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) => throw UnsupportedError('not used');

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async {
    attentionCalls += 1;
    final currentError = error;
    if (currentError != null) throw currentError;
    if (pendingSnapshots.isNotEmpty) {
      return pendingSnapshots.removeAt(0).future;
    }
    return snapshots.removeAt(0);
  }

  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) => throw UnsupportedError('not used');

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) => throw UnsupportedError('not used');
  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');

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

final class _FakeStorage implements CompanionSecureStorage {
  CompanionTrustRecord? record = _trustRecord;
  var saveCalls = 0;
  var forgetCalls = 0;

  @override
  Future<void> forget() async => forgetCalls += 1;

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord value) async => saveCalls += 1;
}

void main() {
  test(
    'manual refresh replaces the in-memory snapshot with fresh rows',
    () async {
      final client = _FakeClient()
        ..snapshots = <AttentionSnapshot>[
          AttentionSnapshot(
            snapshotAt: DateTime.utc(2026, 7, 30, 12),
            items: <AttentionItem>[
              _item(
                taskId: 'T-1',
                projectId: 'P-1',
                projectName: 'Alpha',
                minute: 1,
              ),
            ],
          ),
          AttentionSnapshot(
            snapshotAt: DateTime.utc(2026, 7, 30, 12, 5),
            items: <AttentionItem>[
              _item(
                taskId: 'T-2',
                projectId: 'P-2',
                projectName: 'Beta',
                minute: 5,
              ),
            ],
          ),
        ];
      final storage = _FakeStorage();
      final controller = AttentionController(client: client, storage: storage);

      await controller.refresh();
      expect(
        (controller.state as AttentionLoaded).snapshot.items.single.taskId,
        'T-1',
      );

      final states = <AttentionViewState>[];
      controller.addListener(() => states.add(controller.state));
      await controller.refresh();

      expect(states, hasLength(1));
      expect(states.single, isA<AttentionLoaded>());
      expect(
        (controller.state as AttentionLoaded).snapshot.items.single.taskId,
        'T-2',
      );
      expect(client.attentionCalls, 2);
      expect(
        storage.saveCalls,
        0,
        reason: 'Task data must never enter storage',
      );
    },
  );

  test('refresh failures clear the prior domain snapshot', () async {
    final client = _FakeClient()
      ..snapshots = <AttentionSnapshot>[
        AttentionSnapshot(
          snapshotAt: DateTime.utc(2026, 7, 30),
          items: <AttentionItem>[
            _item(
              taskId: 'T-1',
              projectId: 'P-1',
              projectName: 'Alpha',
              minute: 1,
            ),
          ],
        ),
      ];
    final controller = AttentionController(
      client: client,
      storage: _FakeStorage(),
    );
    await controller.refresh();
    client.error = const CompanionV1Exception(
      statusCode: 503,
      code: 'temporarily_unavailable',
      message: 'raw backend detail',
    );

    await controller.refresh();

    expect(controller.state, isA<AttentionLoadError>());
    expect(
      (controller.state as AttentionLoadError).message,
      isNot(contains('raw')),
    );
  });
  test(
    'revoked or missing credentials leave the connected domain surface',
    () async {
      for (final missingTrust in <bool>[false, true]) {
        var authorizationLosses = 0;
        final client = _FakeClient();
        final storage = _FakeStorage();
        if (missingTrust) {
          storage.record = null;
        } else {
          client.error = const CompanionV1Exception(
            statusCode: 401,
            code: 'revoked',
            message: 'revoked',
          );
        }
        final controller = AttentionController(
          client: client,
          storage: storage,
          onAuthorizationLost: () => authorizationLosses += 1,
        );

        await controller.refresh();

        expect(authorizationLosses, 1);
        expect(controller.state, isA<AttentionLoadError>());
        expect(
          (controller.state as AttentionLoadError).message,
          contains('Pair this phone again'),
        );
      }
    },
  );

  test('only the newest overlapping refresh may commit its snapshot', () async {
    final older = Completer<AttentionSnapshot>();
    final newer = Completer<AttentionSnapshot>();
    final client = _FakeClient()
      ..pendingSnapshots.addAll(<Completer<AttentionSnapshot>>[older, newer]);
    final controller = AttentionController(
      client: client,
      storage: _FakeStorage(),
    );

    final olderRefresh = controller.refreshWithOutcome();
    await Future<void>.delayed(Duration.zero);
    final newerRefresh = controller.refreshWithOutcome();
    await Future<void>.delayed(Duration.zero);
    newer.complete(
      AttentionSnapshot(
        snapshotAt: DateTime.utc(2026, 7, 30, 12, 2),
        items: <AttentionItem>[
          _item(
            taskId: 'newer',
            projectId: 'P-1',
            projectName: 'Alpha',
            minute: 2,
          ),
        ],
      ),
    );
    expect(await newerRefresh, CompanionRefreshOutcome.loaded);
    older.complete(
      AttentionSnapshot(
        snapshotAt: DateTime.utc(2026, 7, 30, 12, 1),
        items: <AttentionItem>[
          _item(
            taskId: 'older',
            projectId: 'P-1',
            projectName: 'Alpha',
            minute: 1,
          ),
        ],
      ),
    );
    expect(await olderRefresh, CompanionRefreshOutcome.superseded);

    expect(
      (controller.state as AttentionLoaded).snapshot.items.single.taskId,
      'newer',
    );
  });

  test('clearing attention invalidates an in-flight snapshot', () async {
    final pending = Completer<AttentionSnapshot>();
    final client = _FakeClient()..pendingSnapshots.add(pending);
    final controller = AttentionController(
      client: client,
      storage: _FakeStorage(),
    );

    final refresh = controller.refresh();
    await Future<void>.delayed(Duration.zero);
    controller.clear();
    pending.complete(
      AttentionSnapshot(
        snapshotAt: DateTime.utc(2026, 7, 30),
        items: <AttentionItem>[
          _item(
            taskId: 'stale',
            projectId: 'P-1',
            projectName: 'Alpha',
            minute: 1,
          ),
        ],
      ),
    );
    await refresh;

    expect(controller.state, isA<AttentionLoading>());
  });

  test('grouping preserves backend project and within-project ordering', () {
    final groups = groupAttentionItems(<AttentionItem>[
      _item(taskId: 'T-2', projectId: 'P-1', projectName: 'Alpha', minute: 2),
      _item(taskId: 'T-1', projectId: 'P-1', projectName: 'Alpha', minute: 1),
      _item(taskId: 'T-3', projectId: 'P-2', projectName: 'Beta', minute: 3),
    ]);

    expect(groups.map((group) => group.projectName), <String>['Alpha', 'Beta']);
    expect(groups.first.items.map((item) => item.taskId), <String>[
      'T-2',
      'T-1',
    ]);
  });
}
