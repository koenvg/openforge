import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_complete_action_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_lifecycle_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_state.dart';

void main() {
  test(
    'rejected Complete refreshes authority once and exposes a safe error',
    () async {
      final client = _CompleteClient();
      final actions = _CompleteActions();
      final lifecycle = TaskDetailLifecycleController(
        taskId: 'KVG-3239',
        client: client,
        storage: _TrustedStorage(),
      )..transitionTo(TaskDetailLoaded(_detail('doing')));
      final controller = TaskCompleteActionController(
        lifecycle: lifecycle,
        actionClient: actions,
      );

      final result = await controller.complete();

      expect(result, TaskCompleteAttempt.failed);
      expect(actions.calls, 1);
      expect(client.detailCalls, 1);
      expect(controller.error, contains('no longer available'));
      expect(controller.error, isNot(contains('/Users/secret')));
      expect(
        (lifecycle.state as TaskDetailLoaded).detail.boardStatus,
        'backlog',
      );
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

final class _CompleteClient implements CompanionClient {
  var detailCalls = 0;

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    detailCalls += 1;
    return _detail('backlog');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _CompleteActions implements CompanionTaskActionClient {
  var calls = 0;

  @override
  Future<TaskCompleteResult> completeTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    calls += 1;
    throw const CompanionV1Exception(
      statusCode: 409,
      code: 'invalid_task_state',
      message: 'raw backend path /Users/secret',
    );
  }
}

final class _TrustedStorage implements CompanionSecureStorage {
  @override
  Future<CompanionTrustRecord?> load() async => _trustRecord;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Storage method was not expected.');
}
