import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../client/companion_refresh_outcome.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';
import 'task_detail_state.dart';

final class TaskDetailLifecycleController extends ChangeNotifier {
  factory TaskDetailLifecycleController({
    required String taskId,
    required CompanionClient client,
    required CompanionSecureStorage storage,
    VoidCallback? onAuthorizationLost,
    TaskBoardRefresh? onBoardRefresh,
  }) => TaskDetailLifecycleController._(
    taskId,
    client,
    storage,
    onAuthorizationLost,
    onBoardRefresh,
  );

  TaskDetailLifecycleController._(
    this.taskId,
    this._client,
    this._storage,
    this._onAuthorizationLost,
    this._onBoardRefresh,
  );

  final String taskId;
  final CompanionClient _client;
  final CompanionSecureStorage _storage;
  final VoidCallback? _onAuthorizationLost;
  final TaskBoardRefresh? _onBoardRefresh;

  var _generation = 0;
  var _disposed = false;
  TaskDetailViewState _state = const TaskDetailLoading();

  TaskDetailViewState get state => _state;
  bool get isDisposed => _disposed;

  Future<void> refresh() async {
    await refreshWithOutcome();
  }

  Future<CompanionRefreshOutcome> refreshWithOutcome() async {
    final generation = ++_generation;
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      if (trustRecord == null) {
        markAuthorizationLost();
        return CompanionRefreshOutcome.authorizationRequired;
      }
      final detail = await _client.fetchTaskDetail(trustRecord, taskId);
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      transitionTo(TaskDetailLoaded(detail));
      return CompanionRefreshOutcome.loaded;
    } on CompanionV1Exception catch (error) {
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      switch (error.code) {
        case 'revoked':
        case 'unauthenticated':
          markAuthorizationLost();
          return CompanionRefreshOutcome.authorizationRequired;
        case 'not_found':
          transitionTo(const TaskDetailNotFound());
          return CompanionRefreshOutcome.notFound;
        case 'incompatible_version':
          transitionTo(const TaskDetailIncompatible());
          return CompanionRefreshOutcome.incompatible;
        default:
          transitionTo(const TaskDetailUnavailable());
          return CompanionRefreshOutcome.unavailable;
      }
    } on Object {
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      transitionTo(const TaskDetailUnavailable());
      return CompanionRefreshOutcome.unavailable;
    }
  }

  Future<CompanionTrustRecord?> requireTrustRecord() async {
    final trustRecord = await _storage.load();
    if (!_disposed && trustRecord == null) markAuthorizationLost();
    return trustRecord;
  }

  Future<bool> refreshAuthoritativeState() async {
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

  void transitionTo(TaskDetailViewState state) {
    if (_disposed) return;
    _state = state;
    notifyListeners();
  }

  void markAuthorizationLost() {
    if (_disposed) return;
    transitionTo(const TaskDetailAuthorizationRequired());
    _onAuthorizationLost?.call();
  }

  void clear() {
    if (_disposed) return;
    _generation += 1;
    transitionTo(const TaskDetailLoading());
  }

  @override
  void dispose() {
    _disposed = true;
    _generation += 1;
    super.dispose();
  }

  bool _isCurrent(int generation) => !_disposed && generation == _generation;
}
