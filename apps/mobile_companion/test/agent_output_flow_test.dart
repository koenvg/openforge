import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/companion_refresh_outcome.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';
import 'package:openforge_companion/src/terminal/agent_terminal_controller.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_client.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_protocol.dart';
import 'package:openforge_companion/src/terminal/openforge_terminal.dart';

void main() {
  testWidgets(
    'presented replay acknowledges through the pinned client and refreshes every projection',
    (tester) async {
      final fixtures =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1-fixtures.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final transport = _FlowTransport(fixtures);
      final client = GeneratedCompanionClient(
        transportFactory: (_) =>
            CompanionEndpointTransport(transport: transport, close: () {}),
      );
      final storage = _Storage();
      var boardRefreshes = 0, attentionRefreshes = 0;
      final detail = TaskDetailController(
        taskId: 'KVG-2946',
        client: client,
        agentOutputClient: client,
        storage: storage,
        onBoardRefresh: () async {
          final board = await client.fetchProjectBoard(storage.record, 'P-4');
          boardRefreshes++;
          expect(board.projectId, 'P-4');
          return CompanionRefreshOutcome.loaded;
        },
        onAttentionRefresh: () async {
          final attention = await client.fetchAttention(storage.record);
          attentionRefreshes++;
          expect(attention.items, isNotNull);
        },
      );
      await detail.refresh();
      final loaded = detail.state as TaskDetailLoaded;
      final channel = _Channel();
      final terminal = _Terminal();
      final presentation = AgentTerminalController(
        taskId: 'KVG-2946',
        client: _TerminalClient(channel),
        storage: storage,
        terminal: terminal,
        onOutputPresented: detail.acknowledgeAgentOutput,
      );
      presentation.updateOccurrence(
        loaded.detail.agentOutputReceipt,
        loaded.detail.agentOutputSessionBinding,
      );
      presentation.updateAvailability(true);
      presentation.setVisible(true);
      await tester.runAsync(_flush);
      expect(transport.viewedPosts, 0);
      channel.add(Uint8List.fromList('new output'.codeUnits));
      channel.add('{"type":"ready","initialState":"replay"}');
      await tester.runAsync(_flush);
      await tester.pump();
      expect(
        transport.viewedPosts,
        0,
        reason: 'ready alone does not acknowledge',
      );
      channel.add(
        '{"type":"presentation_boundary","sessionBinding":"${transport.binding}","receipt":"${transport.receipt}","finalOutput":false}',
      );
      await tester.runAsync(_flush);
      expect(
        transport.viewedPosts,
        0,
        reason: 'presentation waits for the rendered frame',
      );
      await tester.pump();
      await tester.runAsync(_flush);
      expect(terminal.output, 'new output');
      expect(transport.viewedPosts, 1);
      expect(transport.postedReceipt, transport.receipt);
      expect(transport.unread, isFalse);
      expect(boardRefreshes, 1);
      expect(attentionRefreshes, 1);
      expect(
        (detail.state as TaskDetailLoaded).detail.agentOutputReceipt,
        isNull,
      );
      presentation.dispose();
      detail.dispose();
    },
  );
}

Future<void> _flush() async {
  await Future<void>.delayed(Duration.zero);
  await Future<void>.delayed(Duration.zero);
}

final class _FlowTransport implements CompanionV1Transport {
  _FlowTransport(this.fixtures);
  final Map<String, Object?> fixtures;
  final receipt = 'a' * 43;
  final binding = 'b' * 43;
  bool unread = true;
  int viewedPosts = 0;

  String? postedReceipt;
  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    if (uri.path == '/companion/v1/tasks/KVG-2946/agent-output/viewed' &&
        method == 'POST') {
      viewedPosts++;
      postedReceipt = jsonDecode(body!)['receipt'] as String?;
      unread = false;
      return const CompanionV1HttpResponse(
        statusCode: 200,
        body: '{"viewed":true}',
      );
    }
    Object? response;
    if (uri.path == '/companion/v1/tasks/KVG-2946') {
      response = <String, Object?>{
        ...fixtures['taskDetail']! as Map<String, Object?>,
        if (unread) 'agentOutputReceipt': receipt,
        if (unread) 'agentOutputSessionBinding': binding,
      };
    } else if (uri.path == '/companion/v1/projects/P-4/board') {
      response = fixtures['projectBoard'];
    } else if (uri.path == '/companion/v1/attention') {
      response = fixtures['attentionSnapshot'];
    }
    if (response == null) throw StateError('Unexpected $method $uri');
    return CompanionV1HttpResponse(statusCode: 200, body: jsonEncode(response));
  }
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
  Future<CompanionTrustRecord?> load() async => record;
  @override
  Future<void> forget() async {}
  @override
  Future<void> save(CompanionTrustRecord record) async {}
}

final class _TerminalClient implements CompanionTerminalClient {
  _TerminalClient(this.channel);
  final _Channel channel;
  @override
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => channel;
}

final class _Channel implements CompanionAgentTerminalChannel {
  final _frames = StreamController<Object>.broadcast();
  void add(Object frame) => _frames.add(frame);
  @override
  Stream<Object> get frames => _frames.stream;
  @override
  void sendText(String message) {}
  @override
  void sendBinary(List<int> bytes) {}
  @override
  Future<void> close() => _frames.close();
}

final class _Terminal implements OpenForgeTerminal {
  String output = '';
  @override
  Future<void> get layoutReady async {}
  @override
  TerminalDimensions get dimensions =>
      const TerminalDimensions(columns: 80, rows: 24);
  @override
  void writeOutput(Uint8List bytes) => output += utf8.decode(bytes);
  @override
  void flushOutput() {}
  @override
  set outputErrorHandler(void Function(FormatException error)? handler) {}
  @override
  void clear() => output = '';
  @override
  void dispose() {}
}
