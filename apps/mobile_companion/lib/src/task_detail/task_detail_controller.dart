import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
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
    VoidCallback? onAuthorizationLost,
    TaskBoardRefresh? onBoardRefresh,
  }) : taskId = taskId {
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
