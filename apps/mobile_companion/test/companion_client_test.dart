import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

final class _RecordingTransport implements CompanionV1Transport {
  final List<
    ({String method, Uri uri, Map<String, String> headers, String? body})
  >
  requests = [];
  var responses = <CompanionV1HttpResponse>[];

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    requests.add((method: method, uri: uri, headers: headers, body: body));
    return responses.removeAt(0);
  }
}

final class _EndpointTransport implements CloseableCompanionV1Transport {
  _EndpointTransport(this.outcomes);

  final Map<String, Object> outcomes;

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    final outcome = outcomes[uri.host];
    if (outcome is Exception) throw outcome;
    return outcome! as CompanionV1HttpResponse;
  }

  @override
  void close() {}
}

void main() {
  test(
    'generated client matches pairing, status, and attention contracts',
    () async {
      final contract =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1.openapi.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final fixtures =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1-fixtures.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      expect(
        companionV1OpenApiSha256,
        sha256
            .convert(
              File(
                '../../docs/contracts/companion-v1.openapi.json',
              ).readAsBytesSync(),
            )
            .toString(),
        reason: 'checked-in generated client must match the OpenAPI source',
      );
      final encodedContract = jsonEncode(contract);
      expect(encodedContract, contains('submitCompanionPairingRequest'));
      expect(encodedContract, contains('getCompanionPairingRequest'));
      expect(encodedContract, contains('getCompanionHostStatus'));
      expect(encodedContract, contains('getCompanionAttention'));
      expect(encodedContract, contains('getCompanionTaskDetail'));
      final paths = contract['paths']! as Map<String, Object?>;
      expect(
        paths.keys,
        unorderedEquals(<String>[
          '/pairing/requests',
          '/pairing/requests/{requestId}',
          '/status',
          '/attention',
          '/tasks/{taskId}',
        ]),
      );
      for (final path in paths.values.cast<Map<String, Object?>>()) {
        expect(path.keys, everyElement(anyOf('get', 'post')));
      }
      final components = contract['components']! as Map<String, Object?>;
      final schemas = components['schemas']! as Map<String, Object?>;
      final detailSchema = schemas['TaskDetail']! as Map<String, Object?>;
      final detailProperties =
          detailSchema['properties']! as Map<String, Object?>;
      expect(
        detailProperties.keys,
        unorderedEquals(<String>[
          'taskId',
          'title',
          'projectId',
          'projectName',
          'boardStatus',
          'handoffNotes',
          'agentState',
          'agentErrorSummary',
          'createdAt',
          'updatedAt',
          'agentUpdatedAt',
        ]),
      );
      for (final forbidden in <String>[
        'prompt',
        'filesystemPath',
        'worktree',
        'diff',
        'terminalBuffer',
        'providerSessionId',
        'token',
      ]) {
        expect(detailProperties, isNot(contains(forbidden)));
      }

      final transport = _RecordingTransport()
        ..responses = <CompanionV1HttpResponse>[
          CompanionV1HttpResponse(
            statusCode: 202,
            body: jsonEncode(fixtures['pairingSubmissionStatus']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['pairingApproved']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['hostStatus']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['attentionSnapshot']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['taskDetail']),
          ),
        ];
      final client = CompanionV1Client(
        baseUrl: Uri.parse('https://192.168.1.20:17424'),
        transport: transport,
      );

      final submission = await client.submitCompanionPairingRequest(
        secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        deviceName: "Koen's iPhone",
        platform: 'ios',
      );
      final approval = await client.getCompanionPairingRequest(
        requestId: submission.requestId,
        secret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      final status = await client.getCompanionHostStatus(
        credential: approval.credential!,
      );
      final attention = await client.getCompanionAttention(
        credential: approval.credential!,
      );
      final detail = await client.getCompanionTaskDetail(
        taskId: 'KVG-2946',
        credential: approval.credential!,
      );

      expect(status.hostId, '65d91f21-6732-45a6-9418-3dfaf4c93f52');
      expect(status.protocolVersion, 1);
      expect(attention.items.single.taskId, 'KVG-2945');
      expect(attention.items.single.projectName, 'OpenForge');
      expect(attention.items.single.state, 'needs-input');
      expect(detail.title, 'Add mobile Task detail');
      expect(detail.boardStatus, 'doing');
      expect(detail.handoffNotes, 'Ready for review.');
      expect(detail.agentState, 'failed');
      expect(transport.requests[0].uri.path, '/companion/v1/pairing/requests');
      expect(
        jsonDecode(transport.requests[0].body!)['deviceName'],
        "Koen's iPhone",
      );
      expect(
        transport.requests[1].headers['authorization'],
        'Pairing AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      expect(
        transport.requests[2].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(transport.requests[3].uri.path, '/companion/v1/attention');
      expect(
        transport.requests[3].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(transport.requests[4].uri.path, '/companion/v1/tasks/KVG-2946');
      expect(
        transport.requests[4].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
    },
  );

  test('generated decoder rejects schema-invalid pairing responses', () {
    expect(
      () => PairingPoll.fromJson(<String, Object?>{
        'status': 'approved',
        'deviceId': '50b26936-55a7-48e5-a1c7-65eaf08211ee',
      }),
      throwsFormatException,
    );
    expect(
      () => PairingPoll.fromJson(<String, Object?>{
        'status': 'pending',
        'deviceId': null,
      }),
      throwsFormatException,
    );
    expect(
      () => HostStatus.fromJson(<String, Object?>{
        'hostId': '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        'protocolVersion': 1,
        'serverTime': '2026-07-30T12:00:01Z',
        'unexpected': true,
      }),
      throwsFormatException,
    );
    expect(
      () => AttentionItem.fromJson(<String, Object?>{
        'taskId': 'KVG-2945',
        'projectId': 'P-4',
        'projectName': 'OpenForge',
        'title': 'Attention home',
        'state': 'needs-input',
        'reason': 'Agent needs input.',
        'activityAt': '2026-07-30T12:00:01Z',
        'pullRequest': <String, Object?>{'number': 42},
      }),
      throwsFormatException,
    );
  });

  test('endpoint fallback preserves authoritative revocation errors', () async {
    final transport = _RecordingTransport()
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

  test('certificate pinning accepts only the exact SHA-256 fingerprint', () {
    final certificateDer = Uint8List.fromList(const <int>[1, 2, 3, 4]);
    const fingerprint =
        '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:'
        '6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A';

    expect(certificateMatchesPin(certificateDer, fingerprint), isTrue);
    expect(
      certificateMatchesPin(
        certificateDer,
        '0064A747E1B97F131FABB6B447296C9B6F0201E79FB3C5356E6C77E89B6A806A',
      ),
      isFalse,
    );
  });

  test(
    'trusted status connection fails over and reports the verified endpoint',
    () async {
      final outcomes = <String, Object>{
        '192.168.1.20': const SocketException('unreachable'),
        '192.168.1.21': CompanionV1HttpResponse(
          statusCode: 200,
          body: jsonEncode(<String, Object>{
            'hostId': '65d91f21-6732-45a6-9418-3dfaf4c93f52',
            'protocolVersion': 1,
            'serverTime': '2026-07-30T12:00:01Z',
          }),
        ),
      };
      final client = GeneratedCompanionClient(
        transportFactory: (_) => CompanionEndpointTransport(
          transport: _EndpointTransport(outcomes),
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

      final connection = await client.fetchHostStatus(trustRecord);

      expect(connection.endpoint, Uri.parse('https://192.168.1.21:17424'));
      expect(connection.status.hostId, trustRecord.hostId);
    },
  );

  test(
    'certificate mismatch wins when no trusted candidate connects',
    () async {
      final outcomes = <String, Object>{
        '192.168.1.20': const SocketException('unreachable'),
        '192.168.1.21': const CompanionCertificateMismatch(),
      };
      final client = GeneratedCompanionClient(
        transportFactory: (_) => CompanionEndpointTransport(
          transport: _EndpointTransport(outcomes),
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
        throwsA(isA<CompanionCertificateMismatch>()),
      );
    },
  );

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
          transport: _EndpointTransport(outcomes),
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
