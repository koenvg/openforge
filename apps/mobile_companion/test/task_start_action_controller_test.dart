import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/companion_refresh_outcome.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_lifecycle_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_state.dart';
import 'package:openforge_companion/src/task_detail/task_start_action_controller.dart';

void main() {
  test(
    'uncertain Start refreshes Task and Board once without retrying the mutation',
    () async {
      final client = _StartClient();
      var boardRefreshes = 0;
      final lifecycle = TaskDetailLifecycleController(
        taskId: 'KVG-3239',
        client: client,
        storage: _TrustedStorage(),
        onBoardRefresh: () async {
          boardRefreshes += 1;
          return CompanionRefreshOutcome.loaded;
        },
      )..transitionTo(TaskDetailLoaded(_backlogDetail));
      final controller = TaskStartActionController(
        lifecycle: lifecycle,
        client: client,
      );

      await controller.start();

      expect(client.startCalls, 1);
      expect(client.detailCalls, 1);
      expect(boardRefreshes, 1);
      expect(
        controller.state,
        isA<TaskStartUncertain>().having(
          (state) => state.authorityRefreshed,
          'authorityRefreshed',
          isTrue,
        ),
      );
      expect((lifecycle.state as TaskDetailLoaded).detail.boardStatus, 'doing');
    },
  );
}

final _trustRecord = CompanionTrustRecord(
  hostId: 'host-1',
  certificateSha256: 'AA:BB:CC',
  endpointCandidates: <Uri>[Uri.parse('https://desktop.invalid')],
  deviceId: 'device-1',
  deviceCredential: 'secret',
);

final _backlogDetail = _detail('backlog');
final _doingDetail = _detail('doing');

TaskDetail _detail(String boardStatus) => TaskDetail(
  taskId: 'KVG-3239',
  initialPrompt: 'Refactor Task detail lifecycle actions.',
  title: 'Task detail lifecycle actions',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: boardStatus,
  agentState: 'waiting',
  agentErrorSummary: null,
  createdAt: DateTime.utc(2026, 1, 1),
  updatedAt: DateTime.utc(2026, 1, 1),
  agentUpdatedAt: null,
);

final class _StartClient implements CompanionClient {
  var startCalls = 0;
  var detailCalls = 0;

  @override
  Future<TaskStartResult> startTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    startCalls += 1;
    throw const SocketException('response lost');
  }

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    detailCalls += 1;
    return _doingDetail;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _TrustedStorage implements CompanionSecureStorage {
  @override
  Future<CompanionTrustRecord?> load() async => _trustRecord;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Storage method was not expected.');
}
