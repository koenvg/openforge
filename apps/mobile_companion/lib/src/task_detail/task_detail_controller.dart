import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
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
  TaskDetailViewState _state = const TaskDetailLoading();
  TaskDetailViewState get state => _state;

  Future<void> refresh() async {
    final generation = ++_generation;
    _setState(const TaskDetailLoading());
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return;
      if (trustRecord == null) {
        _authorizationLost();
        return;
      }
      final detail = await _client.fetchTaskDetail(trustRecord, taskId);
      if (_isCurrent(generation)) _setState(TaskDetailLoaded(detail));
    } on CompanionV1Exception catch (error) {
      if (!_isCurrent(generation)) return;
      switch (error.code) {
        case 'revoked':
        case 'unauthenticated':
          _authorizationLost();
          return;
        case 'not_found':
          _setState(const TaskDetailNotFound());
          return;
        case 'incompatible_version':
          _setState(const TaskDetailIncompatible());
          return;
        default:
          _setState(const TaskDetailUnavailable());
      }
    } on Object {
      if (_isCurrent(generation)) {
        _setState(const TaskDetailUnavailable());
      }
    }
  }

  @override
  void dispose() {
    _generation += 1;
    super.dispose();
  }

  bool _isCurrent(int generation) => generation == _generation;

  void _authorizationLost() {
    _setState(const TaskDetailAuthorizationRequired());
    _onAuthorizationLost?.call();
  }

  void _setState(TaskDetailViewState state) {
    _state = state;
    notifyListeners();
  }
}
