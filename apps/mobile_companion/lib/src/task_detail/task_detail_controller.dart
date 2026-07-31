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

final class TaskDetailLoaded extends TaskDetailViewState {
  const TaskDetailLoaded(this.detail);

  final TaskDetail detail;
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

final class TaskDetailController extends ChangeNotifier {
  factory TaskDetailController({
    required String taskId,
    required CompanionClient client,
    required CompanionSecureStorage storage,
    VoidCallback? onAuthorizationLost,
  }) => TaskDetailController._(taskId, client, storage, onAuthorizationLost);

  TaskDetailController._(
    this.taskId,
    this._client,
    this._storage,
    this._onAuthorizationLost,
  );

  final String taskId;
  final CompanionClient _client;
  final CompanionSecureStorage _storage;
  final VoidCallback? _onAuthorizationLost;

  var _generation = 0;
  var _disposed = false;
  TaskDetailViewState _state = const TaskDetailLoading();
  TaskDetailViewState get state => _state;

  Future<void> refresh() async {
    await refreshWithOutcome();
  }

  Future<CompanionRefreshOutcome> refreshWithOutcome() async {
    final generation = ++_generation;
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

  void _setState(TaskDetailViewState state) {
    if (_disposed) return;
    _state = state;
    notifyListeners();
  }
}
