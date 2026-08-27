import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/companion_refresh_outcome.dart';
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
  initialPrompt: 'Show mobile Task detail.',
  title: 'Mobile Task detail',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'doing',
  agentState: 'failed',
  agentErrorSummary: 'Agent failed. Review details on the desktop.',
  createdAt: DateTime.utc(2026, 7, 30, 10),
  updatedAt: DateTime.utc(2026, 7, 30, 11),
  agentUpdatedAt: DateTime.utc(2026, 7, 30, 12),
);

final _backlogDetail = TaskDetail(
  taskId: 'KVG-2946',
  initialPrompt: 'Start mobile Task work.',
  title: 'Mobile Task detail',
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'backlog',
  agentState: 'waiting',
  agentErrorSummary: null,
  createdAt: DateTime.utc(2026, 7, 30, 10),
  updatedAt: DateTime.utc(2026, 7, 30, 11),
  agentUpdatedAt: null,
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

  Object result = _detail;
  Completer<TaskDetail>? pendingDetail;
  var taskDetailCalls = 0;
  Object startResult = const TaskStartResult(
    taskId: 'KVG-3031',
    outcome: TaskStartOutcome.started,
  );
  Completer<TaskStartResult>? pendingStart;
  var startCalls = 0;
  Object deleteResult = const TaskDeleteReceipt(
    taskId: 'KVG-2946',
    outcome: 'deleted',
  );
  Completer<TaskDeleteReceipt>? pendingDelete;
  var deleteCalls = 0;
  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    deleteCalls += 1;
    final pending = pendingDelete;
    if (pending != null) return pending.future;
    final current = deleteResult;
    if (current is! TaskDeleteReceipt) throw current;
    return current;
  }

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) => throw UnsupportedError('not used');

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
  Future<TaskStartResult> startTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    startCalls += 1;
    final pending = pendingStart;
    if (pending != null) return pending.future;
    final current = startResult;
    if (current is! TaskStartResult) throw current;
    return current;
  }

  @override
  Future<AttentionSnapshot> fetchAttention(CompanionTrustRecord trustRecord) =>
      throw UnsupportedError('not used');

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

final class _FakeActions implements CompanionTaskActionClient {
  Object result = const TaskCompleteResult(
    taskId: 'KVG-2946',
    boardStatus: 'done',
    cleanupScheduled: true,
  );
  Completer<TaskCompleteResult>? pending;
  var calls = 0;

  @override
  Future<TaskCompleteResult> completeTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    calls += 1;
    final pendingResult = pending;
    if (pendingResult != null) return pendingResult.future;
    final current = result;
    if (current is! TaskCompleteResult) throw current;
    return current;
  }
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

  test(
    'Task refresh keeps the current detail visible until replacement',
    () async {
      final client = _FakeClient();
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        storage: _FakeStorage(),
      );
      await controller.refresh();
      final currentDetail = controller.state;
      client.pendingDetail = Completer<TaskDetail>();

      final refresh = controller.refreshWithOutcome();
      await Future<void>.delayed(Duration.zero);

      expect(controller.state, same(currentDetail));
      client.pendingDetail!.complete(_detail);
      expect(await refresh, CompanionRefreshOutcome.loaded);
      expect(controller.state, isA<TaskDetailLoaded>());
    },
  );

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

  test(
    'Complete is single-flight and disabled while the mutation is pending',
    () async {
      final client = _FakeClient();
      final actions = _FakeActions()..pending = Completer<TaskCompleteResult>();
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        actionClient: actions,
        storage: _FakeStorage(),
      );
      await controller.refresh();

      final firstAttempt = controller.complete();
      await Future<void>.delayed(Duration.zero);

      expect(controller.completePending, isTrue);
      expect(actions.calls, 1);
      expect(await controller.complete(), TaskCompleteAttempt.alreadyPending);
      expect(actions.calls, 1);

      actions.pending!.complete(
        const TaskCompleteResult(
          taskId: 'KVG-2946',
          boardStatus: 'done',
          cleanupScheduled: true,
        ),
      );
      expect(await firstAttempt, TaskCompleteAttempt.completed);
      expect(controller.completePending, isFalse);
      expect(controller.completeError, isNull);
    },
  );

  test(
    'uncertain Complete failure refreshes state once without retrying mutation',
    () async {
      final client = _FakeClient();
      final actions = _FakeActions()
        ..result = TimeoutException('raw network path /Users/secret');
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        actionClient: actions,
        storage: _FakeStorage(),
      );
      await controller.refresh();

      expect(await controller.complete(), TaskCompleteAttempt.failed);

      expect(actions.calls, 1, reason: 'mutations must never be retried');
      expect(
        client.taskDetailCalls,
        2,
        reason: 'current Task state is refreshed',
      );
      expect(controller.state, isA<TaskDetailLoaded>());
      expect(controller.completeError, contains('could not confirm'));
      expect(controller.completeError, isNot(contains('/Users/secret')));
    },
  );

  test(
    'authorization loss during Complete clears authority without retrying',
    () async {
      final actions = _FakeActions()
        ..result = const CompanionV1Exception(
          statusCode: 401,
          code: 'revoked',
          message: 'raw credential detail',
        );
      var authorizationLosses = 0;
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: _FakeClient(),
        actionClient: actions,
        storage: _FakeStorage(),
        onAuthorizationLost: () => authorizationLosses += 1,
      );
      await controller.refresh();

      expect(await controller.complete(), TaskCompleteAttempt.failed);

      expect(actions.calls, 1);
      expect(controller.state, isA<TaskDetailAuthorizationRequired>());
      expect(authorizationLosses, 1);
    },
  );

  test('disposing invalidates an in-flight Task detail request', () async {
    final client = _FakeClient()..pendingDetail = Completer<TaskDetail>();
    final controller = TaskDetailController(
      taskId: 'KVG-2946',
      client: client,
      storage: _FakeStorage(),
    );
    final refresh = controller.refreshWithOutcome();
    await Future<void>.delayed(Duration.zero);
    expect(client.taskDetailCalls, 1);

    controller.dispose();
    client.pendingDetail!.complete(_detail);

    expect(await refresh, CompanionRefreshOutcome.superseded);
  });

  test(
    'Delete is single-flight and reports success without retrying',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..pendingDelete = Completer<TaskDeleteReceipt>();
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        storage: _FakeStorage(),
      );
      await controller.refresh();

      final first = controller.deleteBacklogTask();
      await Future<void>.delayed(Duration.zero);
      final duplicate = await controller.deleteBacklogTask();

      expect(client.deleteCalls, 1);
      expect(duplicate, TaskDeleteResult.ignored);
      expect(
        (controller.state as TaskDetailLoaded).deletePhase,
        TaskDeletePhase.pending,
      );
      client.pendingDelete!.complete(
        const TaskDeleteReceipt(taskId: 'KVG-2946', outcome: 'deleted'),
      );
      expect(await first, TaskDeleteResult.succeeded);
      expect(client.deleteCalls, 1);
    },
  );

  test(
    'stale Delete refreshes current Task state and remains on detail',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..deleteResult = const CompanionV1Exception(
          statusCode: 409,
          code: 'invalid_task_state',
          message: 'raw backend state',
        );
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        storage: _FakeStorage(),
      );
      await controller.refresh();
      client.result = _detail;

      final result = await controller.deleteBacklogTask();

      final loaded = controller.state as TaskDetailLoaded;
      expect(result, TaskDeleteResult.failed);
      expect(client.deleteCalls, 1);
      expect(client.taskDetailCalls, 2);
      expect(loaded.detail.boardStatus, 'doing');
      expect(loaded.deletePhase, TaskDeletePhase.failed);
      expect(loaded.deleteMessage, contains('changed'));
    },
  );

  test(
    'uncertain Delete never retries and safely refreshes current state',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..deleteResult = const SocketException('response lost');
      final controller = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        storage: _FakeStorage(),
      );
      await controller.refresh();

      final result = await controller.deleteBacklogTask();

      final loaded = controller.state as TaskDetailLoaded;
      expect(result, TaskDeleteResult.uncertain);
      expect(client.deleteCalls, 1);
      expect(client.taskDetailCalls, 2);
      expect(loaded.detail, same(_backlogDetail));
      expect(loaded.deletePhase, TaskDeletePhase.uncertain);
      expect(loaded.deleteMessage, contains('was not retried'));
    },
  );
  test(
    'one Start is immediate and duplicate taps are suppressed while pending',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..pendingStart = Completer<TaskStartResult>();
      var boardRefreshes = 0;
      final controller = TaskDetailController(
        taskId: 'KVG-3031',
        client: client,
        storage: _FakeStorage(),
        onBoardRefresh: () async {
          boardRefreshes += 1;
          return CompanionRefreshOutcome.loaded;
        },
      );
      await controller.refresh();

      final first = controller.start();
      await Future<void>.delayed(Duration.zero);
      expect(controller.startAction, isA<TaskStartPending>());
      expect(client.startCalls, 1);

      await controller.start();
      expect(client.startCalls, 1);

      client.result = _detail;
      client.pendingStart!.complete(
        const TaskStartResult(
          taskId: 'KVG-3031',
          outcome: TaskStartOutcome.started,
        ),
      );
      await first;

      expect(client.startCalls, 1);
      expect(boardRefreshes, 1);
      expect(
        (controller.state as TaskDetailLoaded).detail.boardStatus,
        'doing',
      );
      expect(controller.startAction, isA<TaskStartIdle>());
    },
  );

  test(
    'desktop-only preflight refusal stays safe and keeps backlog detail open',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..startResult = const CompanionV1Exception(
          statusCode: 409,
          code: 'desktop_action_required',
          message: 'raw backend workspace detail',
        );
      final controller = TaskDetailController(
        taskId: 'KVG-3031',
        client: client,
        storage: _FakeStorage(),
      );
      await controller.refresh();

      await controller.start();

      expect(controller.startAction, isA<TaskStartDesktopActionRequired>());
      expect(
        (controller.state as TaskDetailLoaded).detail,
        same(_backlogDetail),
      );
      expect(
        controller.startAction.message,
        isNot(contains('workspace detail')),
      );
    },
  );

  test(
    'provider failure refreshes authority and presents a safe retryable error',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..startResult = const CompanionV1Exception(
          statusCode: 503,
          code: 'temporarily_unavailable',
          message: 'provider secret /Users/example',
        );
      var boardRefreshes = 0;
      final controller = TaskDetailController(
        taskId: 'KVG-3031',
        client: client,
        storage: _FakeStorage(),
        onBoardRefresh: () async {
          boardRefreshes += 1;
          return CompanionRefreshOutcome.loaded;
        },
      );
      await controller.refresh();

      await controller.start();

      expect(controller.startAction, isA<TaskStartFailed>());
      expect(controller.startAction.message, isNot(contains('secret')));
      expect(controller.startAction.message, isNot(contains('/Users')));
      expect(client.taskDetailCalls, 2);
      expect(boardRefreshes, 1);
    },
  );

  test(
    'uncertain network outcome refetches Task and Board before enabling retry',
    () async {
      final boardRefresh = Completer<CompanionRefreshOutcome>();
      final client = _FakeClient()
        ..result = _backlogDetail
        ..startResult = const SocketException('response lost');
      var boardRefreshes = 0;
      final controller = TaskDetailController(
        taskId: 'KVG-3031',
        client: client,
        storage: _FakeStorage(),
        onBoardRefresh: () {
          boardRefreshes += 1;
          return boardRefresh.future;
        },
      );
      await controller.refresh();

      final start = controller.start();
      await Future<void>.delayed(Duration.zero);
      expect(controller.startAction, isA<TaskStartPending>());
      expect(client.taskDetailCalls, 2);
      expect(boardRefreshes, 1);

      await controller.start();
      expect(client.startCalls, 1);

      boardRefresh.complete(CompanionRefreshOutcome.loaded);
      await start;
      expect(controller.startAction, isA<TaskStartUncertain>());
    },
  );
  test(
    'retry remains blocked when authoritative Board refresh cannot complete',
    () async {
      final client = _FakeClient()
        ..result = _backlogDetail
        ..startResult = const SocketException('response lost');
      final controller = TaskDetailController(
        taskId: 'KVG-3031',
        client: client,
        storage: _FakeStorage(),
        onBoardRefresh: () async => CompanionRefreshOutcome.unavailable,
      );
      await controller.refresh();

      await controller.start();
      final action = controller.startAction as TaskStartUncertain;
      expect(action.authorityRefreshed, isFalse);

      await controller.start();
      expect(client.startCalls, 1);
    },
  );
}
