import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/companion_transport_fixtures.dart';

void main() {
  test('endpoint fallback preserves authoritative revocation errors', () async {
    final transport = RecordingCompanionTransport()
      ..responses = <CompanionV1HttpResponse>[
        const CompanionV1HttpResponse(
          statusCode: 401,
          body:
              '{"error":{"code":"revoked","message":"Pair again","requestId":null}}',
        ),
        const CompanionV1HttpResponse(
          statusCode: 200,
          body: '{"snapshotAt":"2026-07-30T12:00:02Z","items":[]}',
        ),
      ];
    final client = GeneratedCompanionClient(
      transportFactory: (_) =>
          CompanionEndpointTransport(transport: transport, close: () {}),
    );
    final trust = CompanionTrustRecord(
      hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
      certificateSha256:
          '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A',
      endpointCandidates: <Uri>[
        Uri.parse('https://192.168.1.20:17424'),
        Uri.parse('https://openforge.tailnet:17424'),
      ],
      deviceId: '50b26936-55a7-48e5-a1c7-65eaf08211ee',
      deviceCredential: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
    );

    await expectLater(
      client.fetchAttention(trust),
      throwsA(
        isA<CompanionV1Exception>().having(
          (error) => error.code,
          'code',
          'revoked',
        ),
      ),
    );
    expect(transport.requests, hasLength(1));
  });

  for (final terminal in <({int status, String code})>[
    (status: 401, code: 'revoked'),
    (status: 409, code: 'incompatible_version'),
  ]) {
    test('${terminal.code} response stops endpoint failover', () async {
      final outcomes = <String, Object>{
        '192.168.1.20': CompanionV1HttpResponse(
          statusCode: terminal.status,
          body: jsonEncode(<String, Object>{
            'error': <String, Object?>{
              'code': terminal.code,
              'message': 'Authoritative host response',
              'requestId': null,
            },
          }),
        ),
        '192.168.1.21': const SocketException('stale fallback'),
      };
      final client = GeneratedCompanionClient(
        transportFactory: (_) => CompanionEndpointTransport(
          transport: EndpointCompanionTransport(outcomes),
          close: () {},
        ),
      );
      final trustRecord = CompanionTrustRecord(
        hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        certificateSha256: 'trusted-pin',
        endpointCandidates: <Uri>[
          Uri.parse('https://192.168.1.20:17424'),
          Uri.parse('https://192.168.1.21:17424'),
        ],
        deviceId: 'device-1',
        deviceCredential: 'credential-1',
      );

      await expectLater(
        client.fetchHostStatus(trustRecord),
        throwsA(
          isA<CompanionV1Exception>().having(
            (error) => error.code,
            'code',
            terminal.code,
          ),
        ),
      );
    });
  }
}
