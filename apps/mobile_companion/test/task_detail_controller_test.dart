import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

final _trustRecord = CompanionTrustRecord(
  hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
  certificateSha256:
      '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A',
  endpointCandidates: <Uri>[Uri.parse('https://192.168.1.20:17424')],
  deviceId: '50b26936-55a7-48e5-a1c7-65eaf08211ee',
  deviceCredential: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
);

final _detail = TaskDetail(
  taskId: 'KVG-2946',
  title: 'Mobile Task detail',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'doing',
  handoffNotes: 'Ready for review.',
  agentState: 'failed',
  agentErrorSummary: 'Agent failed. Review details on the desktop.',
  createdAt: DateTime.utc(2026, 7, 30, 10),
  updatedAt: DateTime.utc(2026, 7, 30, 11),
  agentUpdatedAt: DateTime.utc(2026, 7, 30, 12),
);

final class _FakeClient implements CompanionClient {
  Object result = _detail;
  Completer<TaskDetail>? pendingDetail;
  var taskDetailCalls = 0;

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    taskDetailCalls += 1;
    final pending = pendingDetail;
    if (pending != null) return pending.future;
    final current = result;
    if (current is! TaskDetail) throw current;
    return current;
  }

  @override
  Future<AttentionSnapshot> fetchAttention(CompanionTrustRecord trustRecord) =>
      throw UnsupportedError('not used');

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
  var saveCalls = 0;

  @override
  Future<void> forget() async {}

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord value) async => saveCalls += 1;
}

void main() {
  test('loads current Task detail into memory without persisting it', () async {
    final client = _FakeClient();
    final storage = _FakeStorage();
    final controller = TaskDetailController(
      taskId: 'KVG-2946',
      client: client,
      storage: storage,
    );

    await controller.refresh();

    expect((controller.state as TaskDetailLoaded).detail, same(_detail));
    expect(client.taskDetailCalls, 1);
    expect(storage.saveCalls, 0);
  });

  test('maps stable protocol errors to typed Task detail states', () async {
    for (final scenario in <({String code, TaskDetailViewState state})>[
      (code: 'not_found', state: const TaskDetailNotFound()),
      (code: 'revoked', state: const TaskDetailAuthorizationRequired()),
      (code: 'unauthenticated', state: const TaskDetailAuthorizationRequired()),
      (code: 'incompatible_version', state: const TaskDetailIncompatible()),
      (code: 'temporarily_unavailable', state: const TaskDetailUnavailable()),
    ]) {
      final client = _FakeClient()
        ..result = CompanionV1Exception(
          statusCode: 400,
          code: scenario.code,
          message: 'raw backend detail /Users/secret',
        );
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        storage: _FakeStorage(),
      );

      await controller.refresh();

      expect(controller.state.runtimeType, scenario.state.runtimeType);
    }
  });

  test(
    'missing trust maps to authorization required without a request',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage()..record = null;
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        storage: storage,
      );

      await controller.refresh();

      expect(controller.state, isA<TaskDetailAuthorizationRequired>());
      expect(client.taskDetailCalls, 0);
    },
  );

  test('disposing invalidates an in-flight Task detail request', () async {
    final client = _FakeClient()..pendingDetail = Completer<TaskDetail>();
    final controller = TaskDetailController(
      taskId: 'KVG-2946',
      client: client,
      storage: _FakeStorage(),
    );
    final refresh = controller.refresh();
    await Future<void>.delayed(Duration.zero);
    expect(client.taskDetailCalls, 1);

    controller.dispose();
    client.pendingDetail!.complete(_detail);

    await expectLater(refresh, completes);
  });
}
