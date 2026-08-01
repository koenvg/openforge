import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/terminal/agent_terminal_controller.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_client.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_protocol.dart';
import 'package:openforge_companion/src/terminal/openforge_terminal.dart';

void main() {
  test(
    'attaches only when Terminal is visible and preserves replay/live ordering',
    () async {
      final channel = _FakeChannel();
      final client = _FakeTerminalClient(channel);
      final terminal = _FakeTerminal();
      final controller = AgentTerminalController(
        taskId: 'KVG-3018',
        client: client,
        storage: _Storage(),
        terminal: terminal,
        reconnectDelay: Duration.zero,
      );

      controller.updateAvailability(true);
      await _flush();
      expect(client.opens, 0);

      controller.setVisible(true);
      await _flush();
      expect(client.opens, 1);
      expect(
        ClientTerminalControl.decode(channel.sent.single),
        isA<AttachTerminalControl>(),
      );
      expect(controller.state, isA<AgentTerminalAttaching>());

      channel.add(Uint8List.fromList('replay '.codeUnits));
      channel.add('{"type":"ready","initialState":"replay"}');
      channel.add(Uint8List.fromList('live'.codeUnits));
      await _flush();

      expect(terminal.output, 'replay live');
      expect(controller.state, isA<AgentTerminalReady>());

      controller.setVisible(false);
      channel.add(Uint8List.fromList(' hidden'.codeUnits));
      await _flush();
      expect(terminal.output, 'replay live hidden');
      expect(channel.closed, isFalse);

      controller.dispose();
    },
  );

  test(
    'hiding rejects an in-flight attachment and showing reattaches',
    () async {
      final closeGate = Completer<void>();
      final rejectedChannel = _FakeChannel(closeGate: closeGate);
      final acceptedChannel = _FakeChannel();
      final client = _DelayedTerminalClient(acceptedChannel);
      final controller =
          AgentTerminalController(
              taskId: 'KVG-3018',
              client: client,
              storage: _Storage(),
              terminal: _FakeTerminal(),
              reconnectDelay: Duration.zero,
            )
            ..updateAvailability(true)
            ..setVisible(true);
      await _flush();
      expect(client.opens, 1);

      controller.setVisible(false);
      client.complete(rejectedChannel);
      await _flush();

      expect(rejectedChannel.closed, isTrue);
      expect(rejectedChannel.sent, isEmpty);

      controller.setVisible(true);
      await _flush();
      expect(client.opens, 1);

      closeGate.complete();
      await _flush();
      await _flush();
      expect(client.opens, 2);
      expect(acceptedChannel.sent, hasLength(1));
      expect(
        ClientTerminalControl.decode(acceptedChannel.sent.single),
        isA<AttachTerminalControl>(),
      );

      controller.dispose();
    },
  );

  test(
    'exit preserves the final in-memory screen without reconnecting',
    () async {
      final channel = _FakeChannel();
      final client = _FakeTerminalClient(channel);
      final terminal = _FakeTerminal();
      final controller = AgentTerminalController(
        taskId: 'KVG-3018',
        client: client,
        storage: _Storage(),
        terminal: terminal,
        reconnectDelay: Duration.zero,
      )..updateAvailability(true);

      controller.setVisible(true);
      await _flush();
      channel.add(Uint8List.fromList('final screen'.codeUnits));
      channel.add('{"type":"ready","initialState":"replay"}');
      channel.add('{"type":"exited"}');
      await _flush();

      expect(controller.state, isA<AgentTerminalExited>());
      controller.updateAvailability(false);
      expect(controller.state, isA<AgentTerminalExited>());
      expect(terminal.output, 'final screen');
      expect(terminal.clearCount, 0);
      expect(client.opens, 1);

      controller.dispose();
    },
  );

  test(
    'background detaches and clears before a visible foreground reattach',
    () async {
      final channels = <_FakeChannel>[_FakeChannel(), _FakeChannel()];
      final client = _QueueTerminalClient(channels);
      final terminal = _FakeTerminal();
      final controller =
          AgentTerminalController(
              taskId: 'KVG-3018',
              client: client,
              storage: _Storage(),
              terminal: terminal,
              reconnectDelay: Duration.zero,
            )
            ..updateAvailability(true)
            ..setVisible(true);
      await _flush();

      controller.setForeground(false);
      await _flush();
      expect(channels.first.closed, isTrue);
      expect(terminal.clearCount, 1);

      controller.setForeground(true);
      await _flush();
      expect(client.opens, 2);

      controller.dispose();
    },
  );

  test(
    'reconnect uses capped exponential backoff and stops while hidden',
    () async {
      final delays = <Duration>[];
      final client = _FailingTerminalClient();
      late AgentTerminalController controller;
      controller =
          AgentTerminalController(
              taskId: 'KVG-3018',
              client: client,
              storage: _Storage(),
              terminal: _FakeTerminal(),
              reconnectDelay: const Duration(milliseconds: 10),
              maxReconnectDelay: const Duration(milliseconds: 25),
              randomUnit: () => 0,
              delay: (duration) async {
                delays.add(duration);
                if (delays.length == 3) controller.setVisible(false);
              },
            )
            ..updateAvailability(true)
            ..setVisible(true);

      for (var index = 0; index < 8; index += 1) {
        await _flush();
      }

      expect(delays, <Duration>[
        const Duration(milliseconds: 8),
        const Duration(milliseconds: 16),
        const Duration(milliseconds: 25),
      ]);
      expect(client.opens, 3);

      controller.dispose();
    },
  );
}

Future<void> _flush() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

final class _FakeTerminal implements OpenForgeTerminal {
  var output = '';
  var clearCount = 0;

  @override
  TerminalDimensions get dimensions =>
      const TerminalDimensions(columns: 80, rows: 24);

  @override
  void clear() {
    clearCount += 1;
    output = '';
  }

  @override
  void dispose() {}

  @override
  void writeOutput(Uint8List output) {
    this.output += String.fromCharCodes(output);
  }
}

final class _FakeChannel implements CompanionAgentTerminalChannel {
  _FakeChannel({this._closeGate});

  final Completer<void>? _closeGate;
  final _frames = StreamController<Object>.broadcast();
  final sent = <String>[];
  var closed = false;

  @override
  Stream<Object> get frames => _frames.stream;

  void add(Object frame) => _frames.add(frame);

  @override
  void sendText(String message) => sent.add(message);

  @override
  Future<void> close() async {
    closed = true;
    await _closeGate?.future;
    await _frames.close();
  }
}

class _FakeTerminalClient implements CompanionTerminalClient {
  _FakeTerminalClient(this.channel);

  final CompanionAgentTerminalChannel channel;
  var opens = 0;

  @override
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    opens += 1;
    return channel;
  }
}

final class _DelayedTerminalClient implements CompanionTerminalClient {
  _DelayedTerminalClient(this._subsequentChannel);

  final CompanionAgentTerminalChannel _subsequentChannel;
  final _channel = Completer<CompanionAgentTerminalChannel>();
  var opens = 0;

  void complete(CompanionAgentTerminalChannel channel) =>
      _channel.complete(channel);

  @override
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) {
    opens += 1;
    return opens == 1 ? _channel.future : Future.value(_subsequentChannel);
  }
}

final class _FailingTerminalClient implements CompanionTerminalClient {
  var opens = 0;

  @override
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    opens += 1;
    throw StateError('offline');
  }
}

final class _QueueTerminalClient implements CompanionTerminalClient {
  _QueueTerminalClient(this.channels);

  final List<_FakeChannel> channels;
  var opens = 0;

  @override
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => channels[opens++];
}

final class _Storage implements CompanionSecureStorage {
  final record = CompanionTrustRecord(
    hostId: 'host',
    certificateSha256: 'pin',
    endpointCandidates: <Uri>[Uri.parse('https://host:17424')],
    deviceId: 'device',
    deviceCredential: 'credential',
  );

  @override
  Future<void> forget() async {}

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<void> save(CompanionTrustRecord record) async {}
}
