import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../storage/companion_secure_storage.dart';
import 'companion_terminal_client.dart';
import 'companion_terminal_protocol.dart';
import 'openforge_terminal.dart';

Future<void> _defaultDelay(Duration duration) => Future<void>.delayed(duration);

sealed class AgentTerminalState {
  const AgentTerminalState();
}

final class AgentTerminalNoActiveSession extends AgentTerminalState {
  const AgentTerminalNoActiveSession();
}

final class AgentTerminalAttaching extends AgentTerminalState {
  const AgentTerminalAttaching();
}

final class AgentTerminalReady extends AgentTerminalState {
  const AgentTerminalReady();
}

final class AgentTerminalReconnecting extends AgentTerminalState {
  const AgentTerminalReconnecting();
}

final class AgentTerminalExited extends AgentTerminalState {
  const AgentTerminalExited();
}

abstract interface class AgentTerminalPresentation implements Listenable {
  AgentTerminalState get state;

  void updateAvailability(bool available);

  void setVisible(bool visible);

  void setForeground(bool foreground);

  Future<void> closeForTaskCompletion();
}

final class AgentTerminalController extends ChangeNotifier
    implements AgentTerminalPresentation {
  factory AgentTerminalController({
    required String taskId,
    required CompanionTerminalClient client,
    required CompanionSecureStorage storage,
    required OpenForgeTerminal terminal,
    Duration reconnectDelay = const Duration(milliseconds: 300),
    Duration maxReconnectDelay = const Duration(seconds: 30),
    Duration reconnectStabilityDuration = const Duration(seconds: 5),
    double Function()? randomUnit,
    Future<void> Function(Duration)? delay,
    VoidCallback? onAuthorizationLost,
  }) => AgentTerminalController._(
    taskId,
    client,
    storage,
    terminal,
    reconnectDelay,
    maxReconnectDelay,
    reconnectStabilityDuration,
    randomUnit ?? Random().nextDouble,
    delay ?? _defaultDelay,
    onAuthorizationLost,
  );

  AgentTerminalController._(
    this.taskId,
    this._client,
    this._storage,
    this._terminal,
    this.reconnectDelay,
    this.maxReconnectDelay,
    this.reconnectStabilityDuration,
    this._randomUnit,
    this._delay,
    this._onAuthorizationLost,
  ) {
    _terminal.outputErrorHandler = _handleTerminalOutputError;
  }

  final String taskId;
  final Duration reconnectDelay;
  final Duration maxReconnectDelay;
  final Duration reconnectStabilityDuration;
  final CompanionTerminalClient _client;
  final CompanionSecureStorage _storage;
  final OpenForgeTerminal _terminal;
  final VoidCallback? _onAuthorizationLost;
  final double Function() _randomUnit;
  final Future<void> Function(Duration) _delay;

  AgentTerminalState _state = const AgentTerminalNoActiveSession();
  @override
  AgentTerminalState get state => _state;

  CompanionAgentTerminalChannel? _channel;
  StreamSubscription<Object>? _subscription;
  var _generation = 0;
  var _available = false;
  var _visible = false;
  var _foreground = true;
  var _connecting = false;
  var _disposed = false;
  var _terminalExited = false;
  var _protocolFailed = false;
  var _authorizationFailed = false;
  var _handlingDisconnect = false;
  var _reconnectAttempts = 0;
  Stopwatch? _readyUptime;

  @override
  void updateAvailability(bool available) {
    if (_disposed) return;
    final becameAvailable = available && !_available;
    _available = available;
    if (!available && _channel == null && !_connecting && !_terminalExited) {
      _setState(const AgentTerminalNoActiveSession());
    }
    if (becameAvailable) {
      _terminalExited = false;
      _protocolFailed = false;
    }
    _reconcile();
  }

  @override
  void setVisible(bool visible) {
    if (_disposed || _visible == visible) return;
    _visible = visible;
    _reconcile();
  }

  @override
  void setForeground(bool foreground) {
    if (_disposed || _foreground == foreground) return;
    _foreground = foreground;
    if (!foreground) {
      unawaited(_detach(clear: true));
      return;
    }
    _reconcile();
  }

  @override
  Future<void> closeForTaskCompletion() async {
    if (_disposed) return;
    _visible = false;
    await _detach(clear: true);
  }

  bool get inputEnabled =>
      !_disposed &&
      _foreground &&
      _visible &&
      _state is AgentTerminalReady &&
      _channel != null;

  void sendInput(Uint8List input) {
    if (!inputEnabled || input.isEmpty) return;
    try {
      _channel!.sendBinary(input);
    } on Object {
      _scheduleReconnect(_generation);
    }
  }

  void resize(TerminalDimensions dimensions) {
    if (!inputEnabled) return;
    try {
      _channel!.sendText(ResizeTerminalControl(dimensions).encode());
    } on Object {
      _scheduleReconnect(_generation);
    }
  }

  void _reconcile() {
    if (_disposed ||
        !_foreground ||
        !_visible ||
        !_available ||
        _terminalExited ||
        _protocolFailed ||
        _authorizationFailed) {
      return;
    }
    if (_channel == null && !_connecting) unawaited(_attach());
  }

  Future<void> _attach() async {
    if (_connecting || _disposed) return;
    _connecting = true;
    final generation = ++_generation;
    if (_state is! AgentTerminalReconnecting) {
      _setState(const AgentTerminalAttaching());
    }
    var reconcileAfterRejectedChannel = false;
    try {
      final trustRecord = await _storage.load();
      if (!_mayCompleteAttach(generation)) {
        reconcileAfterRejectedChannel = true;
        if (_isCurrent(generation)) {
          _setState(const AgentTerminalNoActiveSession());
        }
        return;
      }
      if (trustRecord == null) {
        _authorizationLost();
        return;
      }
      final channel = await _client.openAgentTerminal(trustRecord, taskId);
      if (!_mayCompleteAttach(generation)) {
        reconcileAfterRejectedChannel = true;
        await channel.close();
        if (_isCurrent(generation)) {
          _setState(const AgentTerminalNoActiveSession());
        }
        return;
      }
      _channel = channel;
      _handlingDisconnect = false;
      _subscription = channel.frames.listen(
        (frame) => _handleFrame(generation, frame),
        onError: (_) => _handleConnectionLoss(generation),
        onDone: () => _handleConnectionLoss(generation),
      );
      channel.sendText(AttachTerminalControl(_terminal.dimensions).encode());
    } on CompanionTerminalAuthorizationRequired {
      if (_isCurrent(generation)) _authorizationLost();
    } on Object {
      if (_isCurrent(generation)) _scheduleReconnect(generation);
    } finally {
      if (_isCurrent(generation)) {
        _connecting = false;
        if (reconcileAfterRejectedChannel && !_handlingDisconnect) {
          _reconcile();
        }
      }
    }
  }

  void _handleFrame(int generation, Object frame) {
    if (!_isCurrent(generation)) return;
    if (frame is List<int>) {
      try {
        _terminal.writeOutput(Uint8List.fromList(frame));
      } on FormatException {
        _protocolFailure(generation);
      }
      return;
    }
    if (frame is! String) {
      _protocolFailure(generation);
      return;
    }
    ServerTerminalControl control;
    try {
      control = ServerTerminalControl.decode(frame);
    } on FormatException {
      _protocolFailure(generation);
      return;
    }
    switch (control) {
      case ReadyTerminalControl():
        if (!_flushTerminalOutput(generation)) return;
        _clearReadyUptime();
        _readyUptime = Stopwatch()..start();
        _setState(const AgentTerminalReady());
      case ExitedTerminalControl():
        if (!_flushTerminalOutput(generation)) return;
        _terminalExited = true;
        _setState(const AgentTerminalExited());
        unawaited(_closeCurrentChannel());
      case ErrorTerminalControl(:final code):
        if (code == 'protocol_error') {
          _protocolFailure(generation);
        } else if (code == 'no_active_agent_terminal' ||
            code == 'attachment_replaced') {
          _terminal.clear();
          _setState(const AgentTerminalNoActiveSession());
          unawaited(_closeCurrentChannel());
        } else {
          _scheduleReconnect(generation);
        }
      case AuthorizationRevokedTerminalControl():
        _authorizationLost();
      case GatewayClosingTerminalControl():
        _scheduleReconnect(generation);
    }
  }

  void _authorizationLost() {
    if (_authorizationFailed) return;
    _authorizationFailed = true;
    _terminal.clear();
    _setState(const AgentTerminalNoActiveSession());
    _onAuthorizationLost?.call();
    unawaited(_closeCurrentChannel());
  }

  void _protocolFailure(int generation) {
    if (!_isCurrent(generation) || _protocolFailed) return;
    _protocolFailed = true;
    _terminal.clear();
    _setState(const AgentTerminalNoActiveSession());
    unawaited(_closeCurrentChannel());
  }

  void _handleConnectionLoss(int generation) {
    if (!_isCurrent(generation) || _handlingDisconnect || _terminalExited) {
      return;
    }
    _scheduleReconnect(generation);
  }

  void _scheduleReconnect(int generation) {
    if (!_isCurrent(generation) || _handlingDisconnect || _terminalExited) {
      return;
    }
    final readyUptime = _readyUptime;
    _readyUptime = null;
    readyUptime?.stop();
    if (readyUptime != null &&
        readyUptime.elapsed >= reconnectStabilityDuration) {
      _reconnectAttempts = 0;
    }
    _handlingDisconnect = true;
    unawaited(_reconnect(generation));
  }

  Duration _nextReconnectDelay() {
    final exponent = min(_reconnectAttempts, 16);
    final multiplier = 1 << exponent;
    final uncappedMilliseconds = reconnectDelay.inMilliseconds * multiplier;
    final jitter = 0.8 + (_randomUnit().clamp(0.0, 1.0) * 0.4);
    final jitteredMilliseconds = (uncappedMilliseconds * jitter).round();
    final cappedMilliseconds = min(
      jitteredMilliseconds,
      maxReconnectDelay.inMilliseconds,
    );
    _reconnectAttempts += 1;
    return Duration(milliseconds: cappedMilliseconds);
  }

  Future<void> _reconnect(int generation) async {
    _terminal.clear();
    if (!_foreground || !_visible || !_available) {
      _setState(const AgentTerminalNoActiveSession());
      _handlingDisconnect = false;
      await _closeCurrentChannel();
      return;
    }
    _setState(const AgentTerminalReconnecting());
    await _closeCurrentChannel();
    if (!_isCurrent(generation)) return;
    await _delay(_nextReconnectDelay());
    if (!_isCurrent(generation)) return;
    _handlingDisconnect = false;
    _reconcile();
  }

  Future<void> _closeCurrentChannel() async {
    _clearReadyUptime();
    final subscription = _subscription;
    final channel = _channel;
    _subscription = null;
    _channel = null;
    await subscription?.cancel();
    await channel?.close();
  }

  Future<void> _detach({required bool clear}) async {
    _generation += 1;
    _connecting = false;
    _handlingDisconnect = false;
    _terminalExited = false;
    _reconnectAttempts = 0;
    _clearReadyUptime();
    if (clear) _terminal.clear();
    if (!_disposed) _setState(const AgentTerminalNoActiveSession());
    await _closeCurrentChannel();
  }

  void _handleTerminalOutputError(FormatException _) {
    if (_disposed) return;
    _protocolFailure(_generation);
  }

  bool _flushTerminalOutput(int generation) {
    try {
      _terminal.flushOutput();
      return true;
    } on FormatException {
      _protocolFailure(generation);
      return false;
    }
  }

  void _clearReadyUptime() {
    _readyUptime?.stop();
    _readyUptime = null;
  }

  bool _isCurrent(int generation) => !_disposed && generation == _generation;

  bool _mayCompleteAttach(int generation) =>
      _isCurrent(generation) &&
      _foreground &&
      _available &&
      !_terminalExited &&
      !_protocolFailed &&
      !_authorizationFailed;

  void _setState(AgentTerminalState state) {
    if (_disposed) return;
    _state = state;
    notifyListeners();
  }

  @override
  void dispose() {
    if (_disposed) return;
    _disposed = true;
    _generation += 1;
    _terminal.outputErrorHandler = null;
    unawaited(_closeCurrentChannel());
    _terminal.clear();
    _terminal.dispose();
    super.dispose();
  }
}
