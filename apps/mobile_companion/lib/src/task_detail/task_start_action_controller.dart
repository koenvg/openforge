import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../generated/companion_v1_client.dart';
import 'task_detail_lifecycle_controller.dart';
import 'task_detail_state.dart';

final class TaskStartActionController extends ChangeNotifier {
  factory TaskStartActionController({
    required TaskDetailLifecycleController lifecycle,
    required CompanionClient client,
  }) => TaskStartActionController._(lifecycle, client);

  TaskStartActionController._(this._lifecycle, this._client);

  final TaskDetailLifecycleController _lifecycle;
  final CompanionClient _client;

  TaskStartActionState _state = const TaskStartIdle();
  var _pending = false;

  TaskStartActionState get state => _state;

  Future<void> start() async {
    if (_lifecycle.isDisposed || _pending) return;
    final currentAction = _state;
    if (currentAction is TaskStartUncertain &&
        !currentAction.authorityRefreshed) {
      return;
    }
    final currentDetail = _lifecycle.state;
    if (currentDetail is! TaskDetailLoaded ||
        currentDetail.detail.boardStatus != 'backlog') {
      return;
    }

    _pending = true;
    _setState(const TaskStartPending());
    try {
      final trustRecord = await _lifecycle.requireTrustRecord();
      if (_lifecycle.isDisposed) return;
      if (trustRecord == null) {
        _setState(const TaskStartIdle());
        return;
      }

      try {
        await _client.startTask(trustRecord, _lifecycle.taskId);
      } on CompanionV1Exception catch (error) {
        await _handleProtocolError(error);
        return;
      } on Object {
        final authorityRefreshed = await _lifecycle.refreshAuthoritativeState();
        if (!_lifecycle.isDisposed) {
          _setState(TaskStartUncertain(authorityRefreshed: authorityRefreshed));
        }
        return;
      }

      await _lifecycle.refreshAuthoritativeState();
      if (!_lifecycle.isDisposed) _setState(const TaskStartIdle());
    } finally {
      _pending = false;
    }
  }

  Future<void> _handleProtocolError(CompanionV1Exception error) async {
    switch (error.code) {
      case 'revoked':
      case 'unauthenticated':
        _lifecycle.markAuthorizationLost();
        _setState(const TaskStartIdle());
      case 'incompatible_version':
        _lifecycle.transitionTo(const TaskDetailIncompatible());
        _setState(const TaskStartIdle());
      case 'desktop_action_required':
        _setState(const TaskStartDesktopActionRequired());
      case 'operation_in_progress':
        await _lifecycle.refreshAuthoritativeState();
        if (!_lifecycle.isDisposed) {
          _setState(
            const TaskStartFailed(
              'Task Start is already in progress. Current Task and Board state were refreshed.',
            ),
          );
        }
      case 'invalid_state':
      case 'not_found':
        await _lifecycle.refreshAuthoritativeState();
        if (!_lifecycle.isDisposed) {
          _setState(
            const TaskStartFailed(
              'This Task is no longer available to Start. Current Task and Board state were refreshed.',
            ),
          );
        }
      default:
        await _lifecycle.refreshAuthoritativeState();
        if (!_lifecycle.isDisposed) {
          _setState(
            const TaskStartFailed(
              'Task could not be started. Current Task and Board state were refreshed; try again.',
            ),
          );
        }
    }
  }

  void _setState(TaskStartActionState state) {
    if (_lifecycle.isDisposed) return;
    _state = state;
    notifyListeners();
  }
}
