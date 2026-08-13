import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';
import 'task_detail_lifecycle_controller.dart';
import 'task_detail_state.dart';

final class TaskDeleteActionController extends ChangeNotifier {
  factory TaskDeleteActionController({
    required TaskDetailLifecycleController lifecycle,
    required CompanionClient client,
  }) => TaskDeleteActionController._(lifecycle, client);

  TaskDeleteActionController._(this._lifecycle, this._client);

  final TaskDetailLifecycleController _lifecycle;
  final CompanionClient _client;

  var _pending = false;

  bool get pending => _pending;

  Future<TaskDeleteResult> deleteBacklogTask() async {
    if (_pending || _lifecycle.isDisposed) return TaskDeleteResult.ignored;
    final current = _lifecycle.state;
    if (current is! TaskDetailLoaded ||
        current.detail.boardStatus != 'backlog') {
      return TaskDeleteResult.ignored;
    }

    _pending = true;
    _lifecycle.transitionTo(
      TaskDetailLoaded(current.detail, deletePhase: TaskDeletePhase.pending),
    );
    CompanionTrustRecord? trustRecord;
    try {
      trustRecord = await _lifecycle.requireTrustRecord();
      if (_lifecycle.isDisposed) return TaskDeleteResult.ignored;
      if (trustRecord == null) {
        _pending = false;
        return TaskDeleteResult.authorizationRequired;
      }
      final receipt = await _client.deleteBacklogTask(
        trustRecord,
        _lifecycle.taskId,
      );
      if (_lifecycle.isDisposed) return TaskDeleteResult.ignored;
      if (receipt.taskId != _lifecycle.taskId || receipt.outcome != 'deleted') {
        throw const FormatException(
          'Task Delete receipt did not match the request.',
        );
      }
      return TaskDeleteResult.succeeded;
    } on CompanionV1Exception catch (error) {
      if (_lifecycle.isDisposed) return TaskDeleteResult.ignored;
      _pending = false;
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _lifecycle.markAuthorizationLost();
        return TaskDeleteResult.authorizationRequired;
      }
      final message = switch (error.code) {
        'invalid_task_state' =>
          'Task state changed on the desktop. Current state was refreshed before another Delete can be considered.',
        'operation_in_progress' =>
          'Another Task operation is in progress. Current state was refreshed; Delete was not retried.',
        'not_found' =>
          'Task is no longer available. Current state was refreshed; Delete was not retried.',
        _ =>
          'Delete could not be completed. Current Task state was refreshed. Try again when ready.',
      };
      await _refreshAfterOutcome(
        trustRecord,
        current.detail,
        TaskDeletePhase.failed,
        message,
      );
      return TaskDeleteResult.failed;
    } on Object {
      if (_lifecycle.isDisposed) return TaskDeleteResult.ignored;
      _pending = false;
      await _refreshAfterOutcome(
        trustRecord,
        current.detail,
        TaskDeletePhase.uncertain,
        'The Delete outcome could not be confirmed. Current Task state was refreshed and Delete was not retried.',
      );
      return TaskDeleteResult.uncertain;
    }
  }

  Future<void> _refreshAfterOutcome(
    CompanionTrustRecord? trustRecord,
    TaskDetail fallback,
    TaskDeletePhase phase,
    String message,
  ) async {
    var detail = fallback;
    if (trustRecord != null) {
      try {
        detail = await _client.fetchTaskDetail(trustRecord, _lifecycle.taskId);
      } on CompanionV1Exception catch (error) {
        if (error.code == 'revoked' || error.code == 'unauthenticated') {
          _lifecycle.markAuthorizationLost();
          return;
        }
      } on Object {
        // Retain the last safe in-memory detail when the current read also fails.
      }
    }
    if (!_lifecycle.isDisposed) {
      _lifecycle.transitionTo(
        TaskDetailLoaded(detail, deletePhase: phase, deleteMessage: message),
      );
    }
  }
}
