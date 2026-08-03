import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/terminal/agent_terminal_controller.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_client.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_protocol.dart';
import 'package:openforge_companion/src/terminal/openforge_terminal.dart';
import 'package:openforge_companion/src/terminal/xterm_terminal_adapter.dart';

void main() {
  test(
    'attaches only when Terminal is visible and preserves replay/live ordering',
    () async {
      final channel = _FakeChannel();
      final client = _FakeTerminalClient(channel);
      final terminal = _FakeTerminal();
      final storage = _Storage();
      final controller = AgentTerminalController(
        taskId: 'KVG-3018',
        client: client,
        storage: storage,
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
      expect(terminal.flushCount, 1);
      expect(controller.state, isA<AgentTerminalReady>());

      controller.setVisible(false);
      channel.add(Uint8List.fromList(' hidden'.codeUnits));
      await _flush();
      expect(terminal.output, 'replay live hidden');
      expect(channel.closed, isFalse);
      expect(storage.loadCount, 1);
      expect(storage.saveCount, 0);
      expect(storage.forgetCount, 0);

      controller.dispose();
      await _flush();
      expect(terminal.output, isEmpty);
      expect(channel.closed, isTrue);
    },
  );

  test('malformed UTF-8 is a protocol failure and is never rendered', () async {
    final channel = _FakeChannel();
    final client = _FakeTerminalClient(channel);
    final terminal = _FakeTerminal(rejectMalformedUtf8: true);
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

    channel.add(Uint8List.fromList(<int>[0x66, 0x80, 0x6f]));
    await _flush();

    expect(terminal.output, isEmpty);
    expect(controller.state, isA<AgentTerminalNoActiveSession>());
    expect(channel.closed, isTrue);

    controller.updateAvailability(true);
    await _flush();
    expect(client.opens, 1);

    controller.dispose();
  });

  test('timed malformed xterm output closes the active channel', () async {
    final channel = _FakeChannel();
    final terminal = XtermOpenForgeTerminal();
    final controller =
        AgentTerminalController(
            taskId: 'KVG-3018',
            client: _FakeTerminalClient(channel),
            storage: _Storage(),
            terminal: terminal,
            reconnectDelay: Duration.zero,
          )
          ..updateAvailability(true)
          ..setVisible(true);
    await _flush();
    channel.add('{"type":"ready","initialState":"replay"}');
    await _flush();
    expect(controller.state, isA<AgentTerminalReady>());

    channel.add(Uint8List.fromList(<int>[0x66, 0x80, 0x6f]));
    await Future<void>.delayed(const Duration(milliseconds: 25));
    await _flush();

    expect(controller.state, isA<AgentTerminalNoActiveSession>());
    expect(channel.closed, isTrue);

    controller.dispose();
  });

  test(
    'server protocol errors stop reconnecting until availability changes',
    () async {
      final channels = <_FakeChannel>[_FakeChannel(), _FakeChannel()];
      final client = _QueueTerminalClient(channels);
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

      channels.first.add(
        '{"type":"error","code":"protocol_error",'
        '"message":"Invalid terminal protocol frame"}',
      );
      await _flush();
      await _flush();

      expect(controller.state, isA<AgentTerminalNoActiveSession>());
      expect(channels.first.closed, isTrue);
      expect(client.opens, 1);

      controller.updateAvailability(true);
      controller.setVisible(false);
      controller.setVisible(true);
      controller.setForeground(false);
      await _flush();
      controller.setForeground(true);
      await _flush();
      expect(client.opens, 1);

      controller.updateAvailability(false);
      controller.updateAvailability(true);
      await _flush();
      expect(client.opens, 2);
      expect(channels.last.sent, hasLength(1));

      controller.dispose();
    },
  );

  test(
    'keyboard resize and typing stay on the same ready attachment',
    () async {
      final channel = _FakeChannel();
      final client = _FakeTerminalClient(channel);
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

      controller.sendInput(Uint8List.fromList('before'.codeUnits));
      controller.resize(const TerminalDimensions(columns: 100, rows: 30));
      expect(channel.sentBinary, isEmpty);
      expect(channel.sent, hasLength(1));

      channel.add('{"type":"ready","initialState":"replay"}');
      await _flush();
      controller.sendInput(Uint8List.fromList(utf8.encode('hé\r')));
      controller.resize(const TerminalDimensions(columns: 100, rows: 30));

      expect(channel.sentBinary, <List<int>>[utf8.encode('hé\r')]);
      expect(
        ClientTerminalControl.decode(channel.sent.last),
        isA<ResizeTerminalControl>(),
      );
      expect(client.opens, 1);
      expect(channel.closed, isFalse);
      expect(controller.state, isA<AgentTerminalReady>());

      controller.setVisible(false);
      controller.sendInput(Uint8List.fromList('hidden'.codeUnits));
      expect(channel.sentBinary, hasLength(1));

      controller.dispose();
    },
  );

  test(
    'hiding preserves an in-flight attachment without enabling input',
    () async {
      final channel = _FakeChannel();
      final client = _DelayedTerminalClient(_FakeChannel());
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
      client.complete(channel);
      await _flush();

      expect(channel.closed, isFalse);
      expect(channel.sent, hasLength(1));
      expect(
        ClientTerminalControl.decode(channel.sent.single),
        isA<AttachTerminalControl>(),
      );
      channel.add('{"type":"ready","initialState":"replay"}');
      await _flush();
      controller.sendInput(Uint8List.fromList('hidden'.codeUnits));
      expect(channel.sentBinary, isEmpty);

      controller.setVisible(true);
      await _flush();
      expect(client.opens, 1);

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

  test('brief ready connections preserve reconnect backoff', () async {
    final delays = <Duration>[];
    final channels = List<_FakeChannel>.generate(4, (_) => _FakeChannel());
    final controller =
        AgentTerminalController(
            taskId: 'KVG-3018',
            client: _QueueTerminalClient(channels),
            storage: _Storage(),
            terminal: _FakeTerminal(),
            reconnectDelay: const Duration(milliseconds: 10),
            maxReconnectDelay: const Duration(milliseconds: 25),
            randomUnit: () => 0,
            delay: (duration) async => delays.add(duration),
          )
          ..updateAvailability(true)
          ..setVisible(true);

    for (var index = 0; index < 3; index += 1) {
      await _flush();
      channels[index].add('{"type":"ready","initialState":"replay"}');
      channels[index].add(
        '{"type":"error","code":"slow_consumer","message":"retry"}',
      );
      await _flush();
      await _flush();
    }

    expect(delays, <Duration>[
      const Duration(milliseconds: 8),
      const Duration(milliseconds: 16),
      const Duration(milliseconds: 25),
    ]);
    expect(channels.take(3).every((channel) => channel.closed), isTrue);
    expect(channels.last.sent, hasLength(1));

    controller.dispose();
  });

  test('a stable ready connection resets reconnect backoff', () async {
    final delays = <Duration>[];
    final channels = List<_FakeChannel>.generate(3, (_) => _FakeChannel());
    final controller =
        AgentTerminalController(
            taskId: 'KVG-3018',
            client: _QueueTerminalClient(channels),
            storage: _Storage(),
            terminal: _FakeTerminal(),
            reconnectDelay: const Duration(milliseconds: 10),
            maxReconnectDelay: const Duration(milliseconds: 25),
            reconnectStabilityDuration: Duration.zero,
            randomUnit: () => 0,
            delay: (duration) async => delays.add(duration),
          )
          ..updateAvailability(true)
          ..setVisible(true);

    await _flush();
    channels.first.add('{"type":"ready","initialState":"replay"}');
    channels.first.add(
      '{"type":"error","code":"slow_consumer","message":"retry"}',
    );
    await _flush();
    await _flush();

    channels[1].add('{"type":"ready","initialState":"replay"}');
    await _flush();
    channels[1].add(
      '{"type":"error","code":"slow_consumer","message":"retry"}',
    );
    await _flush();
    await _flush();

    expect(delays, <Duration>[
      const Duration(milliseconds: 8),
      const Duration(milliseconds: 8),
    ]);
    expect(channels.last.sent, hasLength(1));

    controller.dispose();
  });

  test('a closed ready channel cannot reset a later reconnect', () async {
    final delays = <Duration>[];
    final channels = List<_FakeChannel>.generate(4, (_) => _FakeChannel());
    final controller =
        AgentTerminalController(
            taskId: 'KVG-3018',
            client: _QueueTerminalClient(channels),
            storage: _Storage(),
            terminal: _FakeTerminal(),
            reconnectDelay: const Duration(milliseconds: 10),
            maxReconnectDelay: const Duration(milliseconds: 25),
            reconnectStabilityDuration: const Duration(milliseconds: 10),
            randomUnit: () => 0,
            delay: (duration) async => delays.add(duration),
          )
          ..updateAvailability(true)
          ..setVisible(true);

    await _flush();
    channels.first.add('{"type":"ready","initialState":"replay"}');
    channels.first.add(
      '{"type":"error","code":"slow_consumer","message":"retry"}',
    );
    await _flush();
    await _flush();

    channels[1].add('{"type":"ready","initialState":"replay"}');
    channels[1].add(
      '{"type":"error","code":"no_active_agent_terminal",'
      '"message":"closed"}',
    );
    await _flush();
    await Future<void>.delayed(const Duration(milliseconds: 15));
    controller.updateAvailability(false);
    controller.updateAvailability(true);
    await _flush();

    await channels[2].close();
    await _flush();
    await _flush();

    expect(delays, <Duration>[
      const Duration(milliseconds: 8),
      const Duration(milliseconds: 16),
    ]);
    expect(channels.last.sent, hasLength(1));

    controller.dispose();
  });

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

  test('authorization loss clears content and stops reconnecting', () async {
    final terminal = _FakeTerminal()
      ..writeOutput(Uint8List.fromList('stale'.codeUnits));
    var authorizationLosses = 0;
    final client = _AuthorizationTerminalClient();
    final controller =
        AgentTerminalController(
            taskId: 'KVG-3018',
            client: client,
            storage: _Storage(),
            terminal: terminal,
            reconnectDelay: Duration.zero,
            delay: (_) => Completer<void>().future,
            onAuthorizationLost: () => authorizationLosses += 1,
          )
          ..updateAvailability(true)
          ..setVisible(true);

    await _flush();

    expect(client.opens, 1);
    expect(authorizationLosses, 1);
    expect(terminal.output, isEmpty);
    expect(controller.state, isA<AgentTerminalNoActiveSession>());

    controller.setVisible(false);
    controller.setVisible(true);
    controller.setForeground(false);
    await _flush();
    controller.setForeground(true);
    controller.updateAvailability(false);
    controller.updateAvailability(true);
    await _flush();
    await _flush();
    expect(client.opens, 1);
    expect(authorizationLosses, 1);

    controller.dispose();
  });

  test(
    'a failed input send clears stale state and opens a fresh channel',
    () async {
      final channels = <_FakeChannel>[
        _FakeChannel(throwOnBinarySend: true),
        _FakeChannel(),
      ];
      final terminal = _FakeTerminal();
      final controller =
          AgentTerminalController(
              taskId: 'KVG-3018',
              client: _QueueTerminalClient(channels),
              storage: _Storage(),
              terminal: terminal,
              reconnectDelay: Duration.zero,
            )
            ..updateAvailability(true)
            ..setVisible(true);
      await _flush();
      channels.first.add(Uint8List.fromList('stale'.codeUnits));
      channels.first.add('{"type":"ready","initialState":"replay"}');
      await _flush();

      controller.sendInput(Uint8List.fromList('discard me'.codeUnits));
      await _flush();
      await _flush();

      expect(terminal.output, isEmpty);
      expect(terminal.clearCount, 1);
      expect(channels.first.sentBinary, isEmpty);
      expect(channels.first.closed, isTrue);
      expect(channels.last.sent, hasLength(1));

      controller.dispose();
    },
  );
}

Future<void> _flush() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

final class _FakeTerminal implements OpenForgeTerminal {
  _FakeTerminal({this.rejectMalformedUtf8 = false});

  final bool rejectMalformedUtf8;
  var output = '';
  var clearCount = 0;
  var flushCount = 0;

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
  void flushOutput() {
    flushCount += 1;
  }

  @override
  set outputErrorHandler(void Function(FormatException error)? handler) {}
  @override
  void writeOutput(Uint8List output) {
    final decoded = rejectMalformedUtf8
        ? utf8.decode(output, allowMalformed: false)
        : String.fromCharCodes(output);
    this.output += decoded;
  }
}

final class _FakeChannel implements CompanionAgentTerminalChannel {
  _FakeChannel({this.throwOnBinarySend = false});

  final bool throwOnBinarySend;

  final _frames = StreamController<Object>.broadcast();
  final sent = <String>[];
  final sentBinary = <List<int>>[];
  var closed = false;

  @override
  Stream<Object> get frames => _frames.stream;

  void add(Object frame) => _frames.add(frame);

  @override
  void sendText(String message) => sent.add(message);

  @override
  void sendBinary(List<int> bytes) {
    if (throwOnBinarySend) throw StateError('socket is closed');
    sentBinary.add(List<int>.from(bytes));
  }

  @override
  Future<void> close() async {
    closed = true;
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

final class _AuthorizationTerminalClient implements CompanionTerminalClient {
  var opens = 0;

  @override
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    opens += 1;
    throw const CompanionTerminalAuthorizationRequired();
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
  var loadCount = 0;
  var saveCount = 0;
  var forgetCount = 0;

  @override
  Future<void> forget() async {
    forgetCount += 1;
  }

  @override
  Future<CompanionTrustRecord?> load() async {
    loadCount += 1;
    return record;
  }

  @override
  Future<void> save(CompanionTrustRecord record) async {
    saveCount += 1;
  }
}
