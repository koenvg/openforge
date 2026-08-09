import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../client/companion_refresh_outcome.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';

sealed class TaskDetailViewState {
  const TaskDetailViewState();
}

final class TaskDetailLoading extends TaskDetailViewState {
  const TaskDetailLoading();
}

enum TaskDeletePhase { idle, pending, failed, uncertain }

enum TaskDeleteResult {
  succeeded,
  failed,
  uncertain,
  authorizationRequired,
  ignored,
}

final class TaskDetailLoaded extends TaskDetailViewState {
  const TaskDetailLoaded(
    this.detail, {
    this.deletePhase = TaskDeletePhase.idle,
    this.deleteMessage,
  });

  final TaskDetail detail;
  final TaskDeletePhase deletePhase;
  final String? deleteMessage;
}

final class TaskDetailNotFound extends TaskDetailViewState {
  const TaskDetailNotFound();
}

final class TaskDetailAuthorizationRequired extends TaskDetailViewState {
  const TaskDetailAuthorizationRequired();
}

final class TaskDetailIncompatible extends TaskDetailViewState {
  const TaskDetailIncompatible();
}

final class TaskDetailUnavailable extends TaskDetailViewState {
  const TaskDetailUnavailable();
}

enum TaskCompleteAttempt { completed, failed, alreadyPending }

sealed class TaskStartActionState {
  const TaskStartActionState();

  String get message => '';
}

final class TaskStartIdle extends TaskStartActionState {
  const TaskStartIdle();
}

final class TaskStartPending extends TaskStartActionState {
  const TaskStartPending();
}

final class TaskStartDesktopActionRequired extends TaskStartActionState {
  const TaskStartDesktopActionRequired();

  @override
  String get message =>
      'Open this Task on the desktop to resolve its workspace before starting.';
}

final class TaskStartFailed extends TaskStartActionState {
  const TaskStartFailed(this._message);

  final String _message;

  @override
  String get message => _message;
}

final class TaskStartUncertain extends TaskStartActionState {
  const TaskStartUncertain({required this.authorityRefreshed});

  final bool authorityRefreshed;

  @override
  String get message => authorityRefreshed
      ? 'The Start result could not be confirmed. Current Task and Board state were refreshed before retry.'
      : 'The Start result and current Board state could not be confirmed. Return to the Board and refresh before retrying.';
}

typedef TaskBoardRefresh = Future<CompanionRefreshOutcome> Function();

final class TaskDetailController extends ChangeNotifier {
  factory TaskDetailController({
    required String taskId,
    required CompanionClient client,
    CompanionTaskActionClient? actionClient,
    required CompanionSecureStorage storage,
    VoidCallback? onAuthorizationLost,
    TaskBoardRefresh? onBoardRefresh,
  }) => TaskDetailController._(
    taskId,
    client,
    actionClient,
    storage,
    onAuthorizationLost,
    onBoardRefresh,
  );

  TaskDetailController._(
    this.taskId,
    this._client,
    this._actionClient,
    this._storage,
    this._onAuthorizationLost,
    this._onBoardRefresh,
  );

  final String taskId;
  final CompanionClient _client;
  final CompanionTaskActionClient? _actionClient;
  final CompanionSecureStorage _storage;
  final VoidCallback? _onAuthorizationLost;
  final TaskBoardRefresh? _onBoardRefresh;

  var _generation = 0;
  var _disposed = false;
  TaskDetailViewState _state = const TaskDetailLoading();
  TaskDetailViewState get state => _state;

  TaskStartActionState _startAction = const TaskStartIdle();
  TaskStartActionState get startAction => _startAction;
  bool _startPending = false;

  var _completePending = false;
  bool get completePending => _completePending;

  String? _completeError;
  String? get completeError => _completeError;

  var _deletePending = false;

  bool get completeAvailable =>
      _actionClient != null &&
      switch (_state) {
        TaskDetailLoaded(:final detail) => detail.boardStatus == 'doing',
        _ => false,
      };

  Future<void> refresh() async {
    await refreshWithOutcome();
  }

  Future<CompanionRefreshOutcome> refreshWithOutcome() async {
    if (_deletePending) return CompanionRefreshOutcome.superseded;
    final generation = ++_generation;
    if (!_completePending) _completeError = null;
    _setState(const TaskDetailLoading());
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      if (trustRecord == null) {
        _authorizationLost();
        return CompanionRefreshOutcome.authorizationRequired;
      }
      final detail = await _client.fetchTaskDetail(trustRecord, taskId);
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      _setState(TaskDetailLoaded(detail));
      return CompanionRefreshOutcome.loaded;
    } on CompanionV1Exception catch (error) {
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      switch (error.code) {
        case 'revoked':
        case 'unauthenticated':
          _authorizationLost();
          return CompanionRefreshOutcome.authorizationRequired;
        case 'not_found':
          _setState(const TaskDetailNotFound());
          return CompanionRefreshOutcome.notFound;
        case 'incompatible_version':
          _setState(const TaskDetailIncompatible());
          return CompanionRefreshOutcome.incompatible;
        default:
          _setState(const TaskDetailUnavailable());
          return CompanionRefreshOutcome.unavailable;
      }
    } on Object {
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      _setState(const TaskDetailUnavailable());
      return CompanionRefreshOutcome.unavailable;
    }
  }

  Future<TaskCompleteAttempt> complete() async {
    if (_disposed) return TaskCompleteAttempt.failed;
    if (_completePending) return TaskCompleteAttempt.alreadyPending;
    final actionClient = _actionClient;
    final currentState = _state;
    if (actionClient == null ||
        currentState is! TaskDetailLoaded ||
        currentState.detail.boardStatus != 'doing') {
      return TaskCompleteAttempt.failed;
    }

    _completePending = true;
    _completeError = null;
    notifyListeners();
    try {
      final trustRecord = await _storage.load();
      if (_disposed) return TaskCompleteAttempt.failed;
      if (trustRecord == null) {
        _authorizationLost();
        return TaskCompleteAttempt.failed;
      }
      final result = await actionClient.completeTask(trustRecord, taskId);
      if (_disposed) return TaskCompleteAttempt.failed;
      if (result.taskId != taskId || result.boardStatus != 'done') {
        throw const FormatException('Invalid Task Complete result.');
      }
      return TaskCompleteAttempt.completed;
    } on CompanionV1Exception catch (error) {
      if (_disposed) return TaskCompleteAttempt.failed;
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _authorizationLost();
        return TaskCompleteAttempt.failed;
      }
      final message = _completeFailureMessage(error.code);
      await refreshWithOutcome();
      if (!_disposed) _completeError = message;
      return TaskCompleteAttempt.failed;
    } on Object {
      if (_disposed) return TaskCompleteAttempt.failed;
      const message =
          'OpenForge could not confirm whether Complete succeeded. Current Task state was refreshed; review it before choosing Complete again.';
      await refreshWithOutcome();
      if (!_disposed) _completeError = message;
      return TaskCompleteAttempt.failed;
    } finally {
      if (!_disposed) {
        _completePending = false;
        notifyListeners();
      }
    }
  }

  Future<void> start() async {
    if (_disposed || _startPending) return;
    final startAction = _startAction;
    if (startAction is TaskStartUncertain && !startAction.authorityRefreshed) {
      return;
    }
    final currentState = _state;
    if (currentState is! TaskDetailLoaded ||
        currentState.detail.boardStatus != 'backlog') {
      return;
    }

    _startPending = true;
    _setStartAction(const TaskStartPending());
    try {
      final trustRecord = await _storage.load();
      if (_disposed) return;
      if (trustRecord == null) {
        _authorizationLost();
        _setStartAction(const TaskStartIdle());
        return;
      }

      try {
        await _client.startTask(trustRecord, taskId);
      } on CompanionV1Exception catch (error) {
        await _handleStartProtocolError(error);
        return;
      } on Object {
        final authorityRefreshed = await _refreshAuthoritativeState();
        if (!_disposed) {
          _setStartAction(
            TaskStartUncertain(authorityRefreshed: authorityRefreshed),
          );
        }
        return;
      }

      await _refreshAuthoritativeState();
      if (!_disposed) _setStartAction(const TaskStartIdle());
    } finally {
      _startPending = false;
    }
  }

  Future<void> _handleStartProtocolError(CompanionV1Exception error) async {
    switch (error.code) {
      case 'revoked':
      case 'unauthenticated':
        _authorizationLost();
        _setStartAction(const TaskStartIdle());
      case 'incompatible_version':
        _setState(const TaskDetailIncompatible());
        _setStartAction(const TaskStartIdle());
      case 'desktop_action_required':
        _setStartAction(const TaskStartDesktopActionRequired());
      case 'operation_in_progress':
        await _refreshAuthoritativeState();
        if (!_disposed) {
          _setStartAction(
            const TaskStartFailed(
              'Task Start is already in progress. Current Task and Board state were refreshed.',
            ),
          );
        }
      case 'invalid_state':
      case 'not_found':
        await _refreshAuthoritativeState();
        if (!_disposed) {
          _setStartAction(
            const TaskStartFailed(
              'This Task is no longer available to Start. Current Task and Board state were refreshed.',
            ),
          );
        }
      default:
        await _refreshAuthoritativeState();
        if (!_disposed) {
          _setStartAction(
            const TaskStartFailed(
              'Task could not be started. Current Task and Board state were refreshed; try again.',
            ),
          );
        }
    }
  }

  Future<bool> _refreshAuthoritativeState() async {
    final boardRefresh = _onBoardRefresh;
    final outcomes = await Future.wait<CompanionRefreshOutcome>(
      <Future<CompanionRefreshOutcome>>[
        refreshWithOutcome(),
        if (boardRefresh != null)
          boardRefresh()
        else
          Future<CompanionRefreshOutcome>.value(CompanionRefreshOutcome.loaded),
      ],
    );
    return outcomes.every(
      (outcome) =>
          outcome == CompanionRefreshOutcome.loaded ||
          outcome == CompanionRefreshOutcome.notFound,
    );
  }

  Future<TaskDeleteResult> deleteBacklogTask() async {
    if (_deletePending || _disposed) return TaskDeleteResult.ignored;
    final current = _state;
    if (current is! TaskDetailLoaded ||
        current.detail.boardStatus != 'backlog') {
      return TaskDeleteResult.ignored;
    }

    _deletePending = true;
    _setState(
      TaskDetailLoaded(current.detail, deletePhase: TaskDeletePhase.pending),
    );
    CompanionTrustRecord? trustRecord;
    try {
      trustRecord = await _storage.load();
      if (_disposed) return TaskDeleteResult.ignored;
      if (trustRecord == null) {
        _deletePending = false;
        _authorizationLost();
        return TaskDeleteResult.authorizationRequired;
      }
      final receipt = await _client.deleteBacklogTask(trustRecord, taskId);
      if (_disposed) return TaskDeleteResult.ignored;
      if (receipt.taskId != taskId || receipt.outcome != 'deleted') {
        throw const FormatException(
          'Task Delete receipt did not match the request.',
        );
      }
      return TaskDeleteResult.succeeded;
    } on CompanionV1Exception catch (error) {
      if (_disposed) return TaskDeleteResult.ignored;
      _deletePending = false;
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _authorizationLost();
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
      await _refreshAfterDeleteOutcome(
        trustRecord,
        current.detail,
        TaskDeletePhase.failed,
        message,
      );
      return TaskDeleteResult.failed;
    } on Object {
      if (_disposed) return TaskDeleteResult.ignored;
      _deletePending = false;
      await _refreshAfterDeleteOutcome(
        trustRecord,
        current.detail,
        TaskDeletePhase.uncertain,
        'The Delete outcome could not be confirmed. Current Task state was refreshed and Delete was not retried.',
      );
      return TaskDeleteResult.uncertain;
    }
  }

  Future<void> _refreshAfterDeleteOutcome(
    CompanionTrustRecord? trustRecord,
    TaskDetail fallback,
    TaskDeletePhase phase,
    String message,
  ) async {
    var detail = fallback;
    if (trustRecord != null) {
      try {
        detail = await _client.fetchTaskDetail(trustRecord, taskId);
      } on CompanionV1Exception catch (error) {
        if (error.code == 'revoked' || error.code == 'unauthenticated') {
          _authorizationLost();
          return;
        }
      } on Object {
        // Retain the last safe in-memory detail when the current read also fails.
      }
    }
    if (!_disposed) {
      _setState(
        TaskDetailLoaded(detail, deletePhase: phase, deleteMessage: message),
      );
    }
  }

  void clear() {
    if (_disposed) return;
    _generation += 1;
    _setState(const TaskDetailLoading());
  }

  @override
  void dispose() {
    _disposed = true;
    _generation += 1;
    super.dispose();
  }

  bool _isCurrent(int generation) => !_disposed && generation == _generation;

  void _authorizationLost() {
    _setState(const TaskDetailAuthorizationRequired());
    _onAuthorizationLost?.call();
  }

  void _setStartAction(TaskStartActionState state) {
    if (_disposed) return;
    _startAction = state;
    notifyListeners();
  }

  void _setState(TaskDetailViewState state) {
    if (_disposed) return;
    _state = state;
    notifyListeners();
  }
}

String _completeFailureMessage(String code) => switch (code) {
  'invalid_task_state' =>
    'Complete is no longer available. The current Task state was refreshed.',
  'operation_in_progress' =>
    'Another Task action is already in progress. The current Task state was refreshed.',
  'not_found' =>
    'This Task is no longer active. The current Task state was refreshed.',
  _ =>
    'Complete could not be accepted. The current Task state was refreshed; review it before choosing Complete again.',
};
