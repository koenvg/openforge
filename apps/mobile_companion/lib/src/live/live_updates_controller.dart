import 'dart:async';

import '../attention/attention_controller.dart';
import '../project_board/project_board_controller.dart';
import '../client/companion_client.dart';
import '../client/companion_refresh_outcome.dart';
import '../client/pinned_companion_transport.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';
import '../task_detail/task_detail_controller.dart';

typedef LiveReconnectDelay = Future<void> Function(Duration duration);

final class LiveUpdatesController {
  LiveUpdatesController({
    required this._client,
    required this._storage,
    this._projectBoard,
    this._attention,
    this.maxReconnectAttempts = 5,
    this.reconnectBaseDelay = const Duration(milliseconds: 500),
    this.reconnectMaxDelay = const Duration(seconds: 8),
    this.reconnectStabilityWindow = const Duration(seconds: 10),
    LiveReconnectDelay? delay,
    this.onProjectCatalogInvalidated,
    this.onProjectBoardInvalidated,
    void Function()? onReconnecting,
    void Function()? onConnected,
    void Function()? onUnavailable,
    void Function()? onAuthorizationLost,
    void Function()? onCertificateMismatch,
    void Function()? onIncompatible,
  }) : _callbacks = _LiveConnectionCallbacks(
         onReconnecting: onReconnecting,
         onConnected: onConnected,
         onUnavailable: onUnavailable,
         onAuthorizationLost: onAuthorizationLost,
         onCertificateMismatch: onCertificateMismatch,
         onIncompatible: onIncompatible,
       ),
       _delay = delay ?? _defaultDelay;

  final CompanionClient _client;
  final CompanionSecureStorage _storage;
  ProjectBoardController? _projectBoard;
  AttentionController? _attention;
  final LiveReconnectDelay _delay;
  final FutureOr<void> Function()? onProjectCatalogInvalidated;
  final FutureOr<void> Function(String projectId)? onProjectBoardInvalidated;
  final int maxReconnectAttempts;
  final Duration reconnectBaseDelay;
  final Duration reconnectMaxDelay;
  final Duration reconnectStabilityWindow;
  final _LiveConnectionCallbacks _callbacks;

  TaskDetailController? _openTask;
  CompanionLiveConnection? _connection;
  var _generation = 0;
  var _foreground = false;
  var _running = false;
  String? _lastEventId;

  void setConnectionCallbacks({
    required void Function()? onReconnecting,
    required void Function()? onConnected,
    required void Function()? onUnavailable,
    required void Function()? onAuthorizationLost,
    required void Function()? onCertificateMismatch,
    required void Function()? onIncompatible,
  }) {
    _callbacks.onReconnecting = onReconnecting;
    _callbacks.onConnected = onConnected;
    _callbacks.onUnavailable = onUnavailable;
    _callbacks.onAuthorizationLost = onAuthorizationLost;
    _callbacks.onCertificateMismatch = onCertificateMismatch;
    _callbacks.onIncompatible = onIncompatible;
  }

  void setProjectBoardController(ProjectBoardController? controller) {
    _projectBoard = controller;
  }

  void setAttentionController(AttentionController? controller) {
    _attention = controller;
  }

  void setOpenTask(TaskDetailController? controller) {
    _openTask = controller;
  }

  void start() {
    if (_foreground && _running) return;
    _foreground = true;
    _startLoop();
  }

  void resume() {
    _foreground = true;
    _startLoop();
  }

  Future<void> suspend() async {
    _foreground = false;
    _generation += 1;
    _running = false;
    final connection = _connection;
    _connection = null;
    _clearViews();
    await connection?.close();
  }

  Future<void> stop() async {
    _lastEventId = null;
    await suspend();
  }

  void _startLoop() {
    if (_running) return;
    _running = true;
    final generation = ++_generation;
    unawaited(_run(generation));
  }

  Future<void> _run(int generation) async {
    var reconnectAttempts = 0;
    var reconnecting = false;
    while (_isCurrent(generation)) {
      CompanionLiveConnection? connection;
      DateTime? connectedAt;
      try {
        final trustRecord = await _storage.load();
        if (!_isCurrent(generation)) return;
        if (trustRecord == null) {
          await _authorizationLost();
          return;
        }
        connection = await _client.openLiveEvents(
          trustRecord,
          lastEventId: _lastEventId,
        );
        if (!_isCurrent(generation)) {
          await connection.close();
          return;
        }
        _connection = connection;
        await _refreshViews(clearFirst: reconnecting);
        if (!_isCurrent(generation)) return;
        connectedAt = DateTime.now();
        _callbacks.onConnected?.call();
        reconnecting = false;
        await for (final event in connection.events) {
          if (!_isCurrent(generation)) return;
          final eventId = event.eventId;
          if (eventId != null) _lastEventId = eventId;
          switch (event) {
            case CompanionResourcesInvalidated():
              await _handleInvalidation(event);
              reconnectAttempts = 0;
            case CompanionStreamGap():
              await _refreshViews(clearFirst: true);
              reconnectAttempts = 0;
            case CompanionAuthorizationRevoked():
              await _authorizationLost();
              return;
            case CompanionGatewayClosing():
              throw const _GatewayClosing();
          }
        }
        if (!_isCurrent(generation)) return;
        throw const _StreamEnded();
      } on CompanionCertificateMismatch {
        if (!_isCurrent(generation)) return;
        await _certificateMismatch();
        return;
      } on _RefreshAuthorizationRequired {
        if (!_isCurrent(generation)) return;
        await _authorizationLost();
        return;
      } on _RefreshIncompatible {
        if (!_isCurrent(generation)) return;
        await _incompatible();
        return;
      } on CompanionV1Exception catch (error) {
        if (!_isCurrent(generation)) return;
        if (error.code == 'revoked' || error.code == 'unauthenticated') {
          await _authorizationLost();
          return;
        }
        if (error.code == 'incompatible_version') {
          await _incompatible();
          return;
        }
        reconnectAttempts = _nextReconnectAttempt(
          reconnectAttempts,
          connectedAt,
        );
      } on Object {
        if (!_isCurrent(generation)) return;
        reconnectAttempts = _nextReconnectAttempt(
          reconnectAttempts,
          connectedAt,
        );
      } finally {
        if (identical(_connection, connection)) {
          _connection = null;
          await connection?.close();
        }
      }

      if (!_isCurrent(generation)) return;
      if (reconnectAttempts > maxReconnectAttempts) {
        await _terminalUnavailable();
        return;
      }
      if (!reconnecting) {
        reconnecting = true;
        _clearViews();
        _callbacks.onReconnecting?.call();
      }
      await _delay(_backoff(reconnectAttempts));
    }
  }

  Future<void> _handleInvalidation(CompanionResourcesInvalidated event) async {
    final refreshes = <Future<CompanionRefreshOutcome>>[];
    final catalogInvalidated = event.resources.any(
      (resource) => resource.kind == CompanionResourceKind.projectCatalog,
    );
    final projectBoard = _projectBoard;
    final selectedBoardInvalidated =
        projectBoard != null &&
        event.resources.any(
          (resource) =>
              resource.kind == CompanionResourceKind.projectBoard &&
              resource.id != null &&
              projectBoard.isSelectedProject(resource.id!),
        );

    for (final resource in event.resources) {
      switch (resource.kind) {
        case CompanionResourceKind.projectCatalog:
          await onProjectCatalogInvalidated?.call();
          break;
        case CompanionResourceKind.projectBoard:
          final projectId = resource.id;
          if (projectId != null) {
            await onProjectBoardInvalidated?.call(projectId);
          }
          break;
        case CompanionResourceKind.attention:
        case CompanionResourceKind.task:
          break;
      }
    }

    if (projectBoard != null) {
      if (catalogInvalidated) {
        refreshes.add(projectBoard.refreshWithOutcome());
      } else if (selectedBoardInvalidated) {
        refreshes.add(projectBoard.refreshSelectedBoardWithOutcome());
      }
    }

    final attention = _attention;
    if (attention != null &&
        (catalogInvalidated ||
            event.resources.any(
              (resource) => resource.kind == CompanionResourceKind.attention,
            ))) {
      refreshes.add(attention.refreshWithOutcome());
    }

    final openTask = _openTask;
    if (openTask != null &&
        (catalogInvalidated ||
            selectedBoardInvalidated ||
            event.resources.any(
              (resource) =>
                  resource.kind == CompanionResourceKind.task &&
                  resource.id == openTask.taskId,
            ))) {
      refreshes.add(openTask.refreshWithOutcome());
    }
    _requireCurrentSnapshots(await Future.wait(refreshes));
  }

  Future<void> _refreshViews({required bool clearFirst}) async {
    if (clearFirst) _clearViews();
    final refreshes = <Future<CompanionRefreshOutcome>>[];
    final projectBoard = _projectBoard;
    if (projectBoard != null) {
      refreshes.add(projectBoard.refreshWithOutcome());
    }
    final attention = _attention;
    if (attention != null) refreshes.add(attention.refreshWithOutcome());
    final openTask = _openTask;
    if (openTask != null) refreshes.add(openTask.refreshWithOutcome());
    _requireCurrentSnapshots(await Future.wait(refreshes));
  }

  void _requireCurrentSnapshots(List<CompanionRefreshOutcome> outcomes) {
    if (outcomes.contains(CompanionRefreshOutcome.authorizationRequired)) {
      throw const _RefreshAuthorizationRequired();
    }
    if (outcomes.contains(CompanionRefreshOutcome.incompatible)) {
      throw const _RefreshIncompatible();
    }
    if (outcomes.contains(CompanionRefreshOutcome.unavailable)) {
      throw const _SnapshotUnavailable();
    }
  }

  void _clearViews() {
    _projectBoard?.clear();
    _attention?.clear();
    _openTask?.clear();
  }

  Future<void> _authorizationLost() async {
    _lastEventId = null;
    _clearViews();
    _callbacks.onAuthorizationLost?.call();
    await _terminateLoop();
  }

  Future<void> _terminalUnavailable() async {
    _clearViews();
    _callbacks.onUnavailable?.call();
    await _terminateLoop();
  }

  Future<void> _certificateMismatch() async {
    _clearViews();
    _callbacks.onCertificateMismatch?.call();
    await _terminateLoop();
  }

  Future<void> _incompatible() async {
    _clearViews();
    _callbacks.onIncompatible?.call();
    await _terminateLoop();
  }

  Future<void> _terminateLoop() async {
    _foreground = false;
    _running = false;
    _generation += 1;
    final connection = _connection;
    _connection = null;
    await connection?.close();
  }

  bool _isCurrent(int generation) =>
      _foreground && _running && generation == _generation;

  int _nextReconnectAttempt(int current, DateTime? connectedAt) {
    if (connectedAt != null &&
        DateTime.now().difference(connectedAt) >= reconnectStabilityWindow) {
      return 1;
    }
    return current + 1;
  }

  Duration _backoff(int attempt) {
    final multiplier = 1 << (attempt - 1).clamp(0, 30);
    final milliseconds = reconnectBaseDelay.inMilliseconds * multiplier;
    return Duration(
      milliseconds: milliseconds.clamp(0, reconnectMaxDelay.inMilliseconds),
    );
  }
}

Future<void> _defaultDelay(Duration duration) => Future<void>.delayed(duration);

final class _LiveConnectionCallbacks {
  _LiveConnectionCallbacks({
    this.onReconnecting,
    this.onConnected,
    this.onUnavailable,
    this.onAuthorizationLost,
    this.onCertificateMismatch,
    this.onIncompatible,
  });

  void Function()? onReconnecting;
  void Function()? onConnected;
  void Function()? onUnavailable;
  void Function()? onAuthorizationLost;
  void Function()? onCertificateMismatch;
  void Function()? onIncompatible;
}

final class _GatewayClosing implements Exception {
  const _GatewayClosing();
}

final class _StreamEnded implements Exception {
  const _StreamEnded();
}

final class _RefreshAuthorizationRequired implements Exception {
  const _RefreshAuthorizationRequired();
}

final class _RefreshIncompatible implements Exception {
  const _RefreshIncompatible();
}

final class _SnapshotUnavailable implements Exception {
  const _SnapshotUnavailable();
}
