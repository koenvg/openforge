import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_client.dart';

void main() {
  test(
    'terminal client fails over endpoints with pinned authenticated Task scope',
    () async {
      final attempts = <TerminalConnectRequest>[];
      final channel = _FakeChannel();
      final client = GeneratedCompanionClient(
        terminalConnector: (request) async {
          attempts.add(request);
          if (attempts.length == 1) throw const SocketExceptionForTest();
          return channel;
        },
      );
      final trust = CompanionTrustRecord(
        hostId: 'host',
        certificateSha256: 'abc123',
        endpointCandidates: <Uri>[
          Uri.parse('https://192.168.1.2:17424'),
          Uri.parse('https://openforge.tailnet.ts.net:17424'),
        ],
        deviceId: 'device',
        deviceCredential: 'credential',
      );

      final connected = await client.openAgentTerminal(trust, 'KVG-3018');

      expect(connected, same(channel));
      expect(attempts.map((attempt) => attempt.endpoint.host), <String>[
        '192.168.1.2',
        'openforge.tailnet.ts.net',
      ]);
      expect(attempts.last.taskId, 'KVG-3018');
      expect(attempts.last.certificateSha256, 'abc123');
      expect(attempts.last.credential, 'credential');
    },
  );

  test('terminal authorization loss does not fail over or retry', () async {
    final attempts = <TerminalConnectRequest>[];
    final client = GeneratedCompanionClient(
      terminalConnector: (request) async {
        attempts.add(request);
        throw const CompanionTerminalAuthorizationRequired();
      },
    );
    final trust = CompanionTrustRecord(
      hostId: 'host',
      certificateSha256: 'abc123',
      endpointCandidates: <Uri>[
        Uri.parse('https://192.168.1.2:17424'),
        Uri.parse('https://openforge.tailnet.ts.net:17424'),
      ],
      deviceId: 'device',
      deviceCredential: 'revoked',
    );

    await expectLater(
      client.openAgentTerminal(trust, 'KVG-3018'),
      throwsA(isA<CompanionTerminalAuthorizationRequired>()),
    );
    expect(attempts, hasLength(1));
  });

  test('websocket 401 is classified as terminal authorization loss', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    addTearDown(() => server.close(force: true));
    server.listen((request) async {
      request.response.statusCode = HttpStatus.unauthorized;
      await request.response.close();
    });

    await expectLater(
      openPinnedAgentTerminal(
        TerminalConnectRequest(
          endpoint: Uri.parse('http://${server.address.host}:${server.port}'),
          certificateSha256: 'unused-for-http',
          credential: 'revoked',
          taskId: 'KVG-3018',
        ),
      ),
      throwsA(isA<CompanionTerminalAuthorizationRequired>()),
    );
  });
}

final class SocketExceptionForTest implements Exception {
  const SocketExceptionForTest();
}

final class _FakeChannel implements CompanionAgentTerminalChannel {
  final _frames = StreamController<Object>.broadcast();

  @override
  Stream<Object> get frames => _frames.stream;

  @override
  void sendText(String message) {}

  @override
  void sendBinary(List<int> bytes) {}

  @override
  Future<void> close() async {
    await _frames.close();
  }
}
