import 'dart:async';

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
  Future<void> close() async {
    await _frames.close();
  }
}
