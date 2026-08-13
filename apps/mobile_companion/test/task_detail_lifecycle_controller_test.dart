import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/companion_refresh_outcome.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_lifecycle_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_state.dart';

void main() {
  test('missing trust moves the lifecycle to authorization required', () async {
    final client = _LifecycleClient();
    var authorizationLosses = 0;
    final controller = TaskDetailLifecycleController(
      taskId: 'KVG-3239',
      client: client,
      storage: _EmptyStorage(),
      onAuthorizationLost: () => authorizationLosses += 1,
    );

    final outcome = await controller.refreshWithOutcome();

    expect(outcome, CompanionRefreshOutcome.authorizationRequired);
    expect(controller.state, isA<TaskDetailAuthorizationRequired>());
    expect(client.detailCalls, 0);
    expect(authorizationLosses, 1);
  });
}

final class _LifecycleClient implements CompanionClient {
  var detailCalls = 0;

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    detailCalls += 1;
    throw StateError('Task detail should not be requested without trust.');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _EmptyStorage implements CompanionSecureStorage {
  @override
  Future<CompanionTrustRecord?> load() async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Storage method was not expected.');
}
