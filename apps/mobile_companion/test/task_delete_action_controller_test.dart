import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_delete_action_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_lifecycle_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_state.dart';

void main() {
  test(
    'uncertain Delete refreshes once and never retries the mutation',
    () async {
      final client = _DeleteClient();
      final lifecycle = TaskDetailLifecycleController(
        taskId: 'KVG-3239',
        client: client,
        storage: _TrustedStorage(),
      )..transitionTo(TaskDetailLoaded(_backlogDetail));
      final controller = TaskDeleteActionController(
        lifecycle: lifecycle,
        client: client,
      );

      final result = await controller.deleteBacklogTask();

      expect(result, TaskDeleteResult.uncertain);
      expect(client.deleteCalls, 1);
      expect(client.detailCalls, 1);
      final loaded = lifecycle.state as TaskDetailLoaded;
      expect(loaded.detail, same(_backlogDetail));
      expect(loaded.deletePhase, TaskDeletePhase.uncertain);
      expect(loaded.deleteMessage, contains('was not retried'));
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

final _backlogDetail = TaskDetail(
  taskId: 'KVG-3239',
  initialPrompt: 'Refactor Task detail lifecycle actions.',
  title: 'Task detail lifecycle actions',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'backlog',
  handoffNotes: null,
  agentState: 'waiting',
  agentErrorSummary: null,
  createdAt: DateTime.utc(2026, 1, 1),
  updatedAt: DateTime.utc(2026, 1, 1),
  agentUpdatedAt: null,
);

final class _DeleteClient implements CompanionClient {
  var deleteCalls = 0;
  var detailCalls = 0;

  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    deleteCalls += 1;
    throw const SocketException('response lost');
  }

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    detailCalls += 1;
    return _backlogDetail;
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
