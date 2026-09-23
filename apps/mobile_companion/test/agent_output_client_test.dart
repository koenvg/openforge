import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/companion_transport_fixtures.dart';

void main() {
  final trust = CompanionTrustRecord(
    hostId: 'host',
    certificateSha256: 'trusted-pin',
    endpointCandidates: <Uri>[Uri.parse('https://host.example:17424')],
    deviceId: 'device',
    deviceCredential: 'credential',
  );

  test(
    'Board and Task reads opt in while old hosts retain absent fields',
    () async {
      final fixtures =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1-fixtures.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final transport = RecordingCompanionTransport()
        ..responses = <CompanionV1HttpResponse>[
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['projectBoard']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['taskDetail']),
          ),
        ];
      final client = GeneratedCompanionClient(
        transportFactory: (_) =>
            CompanionEndpointTransport(transport: transport, close: () {}),
      );

      final board = await client.fetchProjectBoard(trust, 'P-4');
      final detail = await client.fetchTaskDetail(trust, 'T-1');

      expect(
        transport.requests.map(
          (request) => request.uri.queryParameters['includeAgentOutput'],
        ),
        <String?>['true', 'true'],
      );
      expect(board.lanes.focus.single.hasUnreadAgentOutput, isNull);
      expect(detail.agentOutputReceipt, isNull);
      expect(detail.agentOutputSessionBinding, isNull);
    },
  );

  test(
    'Agent output acknowledgement makes one pinned POST with the receipt',
    () async {
      final transport = RecordingCompanionTransport()
        ..responses = <CompanionV1HttpResponse>[
          const CompanionV1HttpResponse(
            statusCode: 200,
            body: '{"viewed":true}',
          ),
        ];
      final client = GeneratedCompanionClient(
        transportFactory: (_) =>
            CompanionEndpointTransport(transport: transport, close: () {}),
      );

      final result = await client.markAgentOutputViewed(
        trust,
        'T-1',
        'opaque-receipt',
      );

      expect(result.viewed, isTrue);
      expect(transport.requests, hasLength(1));
      expect(transport.requests.single.method, 'POST');
      expect(
        transport.requests.single.uri.path,
        '/companion/v1/tasks/T-1/agent-output/viewed',
      );
      expect(jsonDecode(transport.requests.single.body!), <String, Object?>{
        'receipt': 'opaque-receipt',
      });
      expect(
        transport.requests.single.headers['authorization'],
        'Bearer credential',
      );
    },
  );
}
