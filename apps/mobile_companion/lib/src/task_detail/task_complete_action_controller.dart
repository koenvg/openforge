import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../generated/companion_v1_client.dart';
import 'task_detail_lifecycle_controller.dart';
import 'task_detail_state.dart';

final class TaskCompleteActionController extends ChangeNotifier {
  factory TaskCompleteActionController({
    required TaskDetailLifecycleController lifecycle,
    required CompanionTaskActionClient? actionClient,
  }) => TaskCompleteActionController._(lifecycle, actionClient);

  TaskCompleteActionController._(this._lifecycle, this._actionClient);

  final TaskDetailLifecycleController _lifecycle;
  final CompanionTaskActionClient? _actionClient;

  var _pending = false;
  String? _error;

  bool get pending => _pending;
  String? get error => _error;
  bool get available =>
      _actionClient != null &&
      switch (_lifecycle.state) {
        TaskDetailLoaded(:final detail) => detail.boardStatus == 'doing',
        _ => false,
      };

  void clearError() {
    if (_pending || _error == null || _lifecycle.isDisposed) return;
    _error = null;
    notifyListeners();
  }

  Future<TaskCompleteAttempt> complete() async {
    if (_lifecycle.isDisposed) return TaskCompleteAttempt.failed;
    if (_pending) return TaskCompleteAttempt.alreadyPending;
    final actionClient = _actionClient;
    final currentState = _lifecycle.state;
    if (actionClient == null ||
        currentState is! TaskDetailLoaded ||
        currentState.detail.boardStatus != 'doing') {
      return TaskCompleteAttempt.failed;
    }

    _pending = true;
    _error = null;
    notifyListeners();
    try {
      final trustRecord = await _lifecycle.requireTrustRecord();
      if (_lifecycle.isDisposed) return TaskCompleteAttempt.failed;
      if (trustRecord == null) return TaskCompleteAttempt.failed;

      final result = await actionClient.completeTask(
        trustRecord,
        _lifecycle.taskId,
      );
      if (_lifecycle.isDisposed) return TaskCompleteAttempt.failed;
      if (result.taskId != _lifecycle.taskId || result.boardStatus != 'done') {
        throw const FormatException('Invalid Task Complete result.');
      }
      return TaskCompleteAttempt.completed;
    } on CompanionV1Exception catch (error) {
      if (_lifecycle.isDisposed) return TaskCompleteAttempt.failed;
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _lifecycle.markAuthorizationLost();
        return TaskCompleteAttempt.failed;
      }
      final message = _failureMessage(error.code);
      await _lifecycle.refreshWithOutcome();
      if (!_lifecycle.isDisposed) _error = message;
      return TaskCompleteAttempt.failed;
    } on Object {
      if (_lifecycle.isDisposed) return TaskCompleteAttempt.failed;
      const message =
          'OpenForge could not confirm whether Complete succeeded. Current Task state was refreshed; review it before choosing Complete again.';
      await _lifecycle.refreshWithOutcome();
      if (!_lifecycle.isDisposed) _error = message;
      return TaskCompleteAttempt.failed;
    } finally {
      if (!_lifecycle.isDisposed) {
        _pending = false;
        notifyListeners();
      }
    }
  }
}

String _failureMessage(String code) => switch (code) {
  'invalid_task_state' =>
    'Complete is no longer available. The current Task state was refreshed.',
  'operation_in_progress' =>
    'Another Task action is already in progress. The current Task state was refreshed.',
  'not_found' =>
    'This Task is no longer active. The current Task state was refreshed.',
  _ =>
    'Complete could not be accepted. The current Task state was refreshed; review it before choosing Complete again.',
};
