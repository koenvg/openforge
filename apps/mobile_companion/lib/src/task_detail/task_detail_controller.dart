import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../generated/companion_v1_client.dart';
import '../client/companion_refresh_outcome.dart';
import '../storage/companion_secure_storage.dart';
import 'task_complete_action_controller.dart';
import 'task_delete_action_controller.dart';
import 'task_detail_lifecycle_controller.dart';
import 'task_detail_state.dart';
import 'task_start_action_controller.dart';

export 'task_detail_state.dart';

final class TaskDetailController extends ChangeNotifier {
  TaskDetailController({
    required String taskId,
    required CompanionClient client,
    CompanionTaskActionClient? actionClient,
    required CompanionSecureStorage storage,
    CompanionAgentOutputClient? agentOutputClient,
    Future<void> Function()? onAttentionRefresh,
    VoidCallback? onAuthorizationLost,
    TaskBoardRefresh? onBoardRefresh,
  }) : taskId = taskId {
    _agentOutputClient = agentOutputClient;
    _onAttentionRefresh = onAttentionRefresh;
    _lifecycle = TaskDetailLifecycleController(
      taskId: taskId,
      client: client,
      storage: storage,
      onAuthorizationLost: onAuthorizationLost,
      onBoardRefresh: onBoardRefresh,
    );
    _startController = TaskStartActionController(
      lifecycle: _lifecycle,
      client: client,
    );
    _completeController = TaskCompleteActionController(
      lifecycle: _lifecycle,
      actionClient: actionClient,
    );
    _deleteController = TaskDeleteActionController(
      lifecycle: _lifecycle,
      client: client,
    );
    _lifecycle.addListener(_relayChange);
    _startController.addListener(_relayChange);
    _completeController.addListener(_relayChange);
    _deleteController.addListener(_relayChange);
  }

  final String taskId;
  late final TaskDetailLifecycleController _lifecycle;
  late final TaskStartActionController _startController;
  late final TaskCompleteActionController _completeController;
  late final TaskDeleteActionController _deleteController;
  late final CompanionAgentOutputClient? _agentOutputClient;
  late final Future<void> Function()? _onAttentionRefresh;
  String? _acknowledgingReceipt;
  var _disposed = false;

  TaskDetailViewState get state => _lifecycle.state;
  TaskStartActionState get startAction => _startController.state;
  bool get completePending => _completeController.pending;
  String? get completeError => _completeController.error;
  bool get completeAvailable => _completeController.available;

  Future<void> refresh() async {
    await refreshWithOutcome();
  }

  Future<CompanionRefreshOutcome> refreshWithOutcome() async {
    if (_deleteController.pending) return CompanionRefreshOutcome.superseded;
    _completeController.clearError();
    return _lifecycle.refreshWithOutcome();
  }

  Future<void> acknowledgeAgentOutput(String receipt) async {
    final action = _agentOutputClient;
    final current = _lifecycle.state;
    if (_disposed ||
        action == null ||
        _acknowledgingReceipt != null ||
        current is! TaskDetailLoaded ||
        current.detail.agentOutputReceipt != receipt ||
        current.detail.agentOutputSessionBinding == null) {
      return;
    }
    _acknowledgingReceipt = receipt;
    var attempted = false;
    try {
      final trustRecord = await _lifecycle.requireTrustRecord();
      final latest = _lifecycle.state;
      if (trustRecord == null ||
          _disposed ||
          latest is! TaskDetailLoaded ||
          latest.detail.agentOutputReceipt != receipt) {
        return;
      }
      attempted = true;
      await action.markAgentOutputViewed(trustRecord, taskId, receipt);
      if (!_disposed) await _refreshOutputProjections();
    } on CompanionV1Exception catch (error) {
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _lifecycle.markAuthorizationLost();
      } else if (attempted) {
        await _refreshOutputProjections();
      }
    } on Object {
      // An uncertain response is never retried; refresh authoritative state.
      if (attempted) await _refreshOutputProjections();
    } finally {
      _acknowledgingReceipt = null;
    }
  }

  Future<void> _refreshOutputProjections() async {
    if (_disposed) return;
    try {
      await Future.wait(<Future<void>>[
        _lifecycle.refreshAuthoritativeState().then((_) {}),
        if (_onAttentionRefresh case final refresh?) refresh(),
      ]);
    } on Object {
      // The individual read controllers retain their unavailable states.
    }
  }

  Future<TaskCompleteAttempt> complete() => _completeController.complete();

  Future<void> start() => _startController.start();

  Future<TaskDeleteResult> deleteBacklogTask() =>
      _deleteController.deleteBacklogTask();

  void clear() => _lifecycle.clear();

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _lifecycle.removeListener(_relayChange);
    _startController.removeListener(_relayChange);
    _completeController.removeListener(_relayChange);
    _deleteController.removeListener(_relayChange);
    _lifecycle.dispose();
    _startController.dispose();
    _completeController.dispose();
    _deleteController.dispose();
    super.dispose();
  }

  void _relayChange() {
    if (!_disposed) notifyListeners();
  }
}
