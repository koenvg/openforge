import 'dart:async';

import 'package:flutter/material.dart';

import '../attention/attention_controller.dart';
import '../live/live_updates_controller.dart';
import '../pairing/companion_pairing_controller.dart';
import '../project_board/project_board_controller.dart';
import '../task_detail/task_detail_controller.dart';
import 'companion_connection_state.dart';

final class CompanionConnectionCoordinator extends ChangeNotifier {
  CompanionConnectionCoordinator({
    CompanionPairingController? pairingController,
    this._projectBoardController,
    this._attentionController,
    this._liveUpdatesController,
    this._navigatorKey,
    CompanionConnectionState initialState = const Unpaired(),
  }) : _pairingController = pairingController,
       _connectionState = pairingController?.state ?? initialState {
    _pairingController?.addListener(_onPairingChanged);
    _configureLiveController();
  }

  CompanionPairingController? _pairingController;
  ProjectBoardController? _projectBoardController;
  AttentionController? _attentionController;
  LiveUpdatesController? _liveUpdatesController;
  final GlobalKey<NavigatorState>? _navigatorKey;
  CompanionConnectionState _connectionState;
  TaskDetailController? _openTaskController;
  var _foreground = true;
  var _disposed = false;

  CompanionConnectionState get connectionState => _connectionState;

  void update({
    CompanionPairingController? pairingController,
    ProjectBoardController? projectBoardController,
    AttentionController? attentionController,
    LiveUpdatesController? liveUpdatesController,
    bool pairingControllerChanged = true,
    bool projectBoardControllerChanged = false,
    bool attentionControllerChanged = false,
    bool liveUpdatesControllerChanged = false,
  }) {
    final previousState = _connectionState;
    if (pairingControllerChanged &&
        !identical(_pairingController, pairingController)) {
      _pairingController?.cancelPendingOperation();
      _pairingController?.removeListener(_onPairingChanged);
      _pairingController = pairingController;
      _pairingController?.addListener(_onPairingChanged);
      _connectionState = pairingController?.state ?? _connectionState;
    }
    if (projectBoardControllerChanged) {
      _projectBoardController = projectBoardController;
    }
    if (attentionControllerChanged) {
      _attentionController = attentionController;
    }
    if (liveUpdatesControllerChanged) {
      _releaseLiveController(_liveUpdatesController);
      _liveUpdatesController = liveUpdatesController;
    } else if (pairingControllerChanged) {
      _clearLiveCallbacks(_liveUpdatesController);
      unawaited(_liveUpdatesController?.stop());
    } else if (projectBoardControllerChanged || attentionControllerChanged) {
      unawaited(_liveUpdatesController?.suspend());
    }
    _configureLiveController();
    _reconcile(
      previousState,
      ownershipChanged:
          pairingControllerChanged ||
          projectBoardControllerChanged ||
          attentionControllerChanged ||
          liveUpdatesControllerChanged,
    );
    notifyListeners();
  }

  void setOpenTask(TaskDetailController? controller) {
    _openTaskController = controller;
    _liveUpdatesController?.setOpenTask(controller);
  }

  void resume() {
    _foreground = true;
    _resumeUpdatesForCurrentState();
  }

  void suspend() {
    _foreground = false;
    unawaited(_liveUpdatesController?.suspend());
  }

  void _onPairingChanged() {
    final previousState = _connectionState;
    _connectionState = _pairingController!.state;
    _reconcile(previousState);
    notifyListeners();
  }

  void _reconcile(
    CompanionConnectionState previous, {
    bool ownershipChanged = false,
  }) {
    final wasActive = previous is Connected || previous is Reconnecting;
    final isActive =
        _connectionState is Connected || _connectionState is Reconnecting;
    final becameConnected =
        _connectionState is Connected && previous is! Connected;

    if (_connectionState is! Connected && previous is Connected) {
      _navigatorKey?.currentState?.popUntil((route) => route.isFirst);
      _projectBoardController?.clear();
      _attentionController?.clear();
      _openTaskController?.clear();
    }
    if (wasActive && !isActive) {
      unawaited(_liveUpdatesController?.stop());
    }
    if ((isActive && !wasActive) || becameConnected || ownershipChanged) {
      _resumeUpdatesForCurrentState();
    }
  }

  void _resumeUpdatesForCurrentState() {
    if (!_foreground || _disposed) return;
    final board = _projectBoardController;
    final attention = _attentionController;
    if (board == null && attention == null && _openTaskController == null) {
      return;
    }

    final live = _liveUpdatesController;
    if (live != null) {
      _configureLiveController();
      if (_connectionState is Connected || _connectionState is Reconnecting) {
        live.resume();
      }
    } else if (_connectionState is Connected) {
      if (board != null) {
        unawaited(board.refresh());
      } else if (attention != null) {
        unawaited(attention.refresh());
      } else {
        unawaited(_openTaskController!.refresh());
      }
    }
  }

  void _configureLiveController() {
    final live = _liveUpdatesController;
    if (live == null) return;
    live.setConnectionCallbacks(
      onReconnecting: _pairingController?.liveReconnecting,
      onConnected: _pairingController?.liveConnected,
      onUnavailable: _pairingController?.liveUnavailable,
      onAuthorizationLost: _pairingController?.authorizationLost,
      onCertificateMismatch: _pairingController?.liveCertificateMismatch,
      onIncompatible: _pairingController?.liveIncompatible,
    );
    live.setProjectBoardController(_projectBoardController);
    live.setAttentionController(_attentionController);
    live.setOpenTask(_openTaskController);
  }

  void _clearLiveCallbacks(LiveUpdatesController? live) {
    live?.setConnectionCallbacks(
      onReconnecting: null,
      onConnected: null,
      onUnavailable: null,
      onAuthorizationLost: null,
      onCertificateMismatch: null,
      onIncompatible: null,
    );
  }

  void _releaseLiveController(LiveUpdatesController? live) {
    live?.setOpenTask(null);
    live?.setProjectBoardController(null);
    live?.setAttentionController(null);
    _clearLiveCallbacks(live);
    unawaited(live?.suspend());
  }

  @override
  void dispose() {
    _disposed = true;
    _foreground = false;
    _pairingController?.removeListener(_onPairingChanged);
    _releaseLiveController(_liveUpdatesController);
    super.dispose();
  }
}
