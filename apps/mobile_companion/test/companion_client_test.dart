import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
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
  _EndpointTransport(this.outcomes, {this.requests});

  final Map<String, Object> outcomes;
  final List<({Uri uri, Map<String, String> headers})>? requests;

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    requests?.add((uri: uri, headers: headers));
    Object? outcome = outcomes[uri.host];
    if (outcome is List<Object>) outcome = outcome.removeAt(0);
    if (outcome is Exception) throw outcome;
    if (outcome is Future<CompanionV1HttpResponse>) return await outcome;
    return outcome! as CompanionV1HttpResponse;
  }

  @override
  void close() {}
}

typedef _RunTaskMutation =
    Future<Object> Function(
      GeneratedCompanionClient client,
      CompanionTrustRecord trust,
    );
typedef _TaskMutation = ({String path, _RunTaskMutation run});

void main() {
  test(
    'generated client matches pairing, reads, Task mutations, and event contracts',
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
      expect(encodedContract, contains('getCompanionProjects'));
      expect(encodedContract, contains('getCompanionProjectBoard'));
      expect(encodedContract, contains('createCompanionTask'));
      expect(encodedContract, contains('getCompanionTaskDetail'));
      expect(encodedContract, contains('completeCompanionTask'));
      expect(encodedContract, contains('startCompanionTask'));
      expect(encodedContract, contains('deleteCompanionBacklogTask'));
      expect(encodedContract, contains('streamCompanionEvents'));
      final paths = contract['paths']! as Map<String, Object?>;
      expect(
        paths.keys,
        unorderedEquals(<String>[
          '/pairing/requests',
          '/pairing/requests/{requestId}',
          '/status',
          '/attention',
          '/projects',
          '/projects/{projectId}/board',
          '/projects/{projectId}/tasks',
          '/tasks/{taskId}',
          '/tasks/{taskId}/complete',
          '/tasks/{taskId}/start',
          '/tasks/{taskId}/delete',
          '/events',
        ]),
      );
      for (final path in paths.values.cast<Map<String, Object?>>()) {
        expect(path.keys, everyElement(anyOf('get', 'post')));
      }
      final eventsPath = paths['/events']! as Map<String, Object?>;
      final eventsOperation = eventsPath['get']! as Map<String, Object?>;
      final eventVocabulary = eventsOperation['x-sse-events']! as List<Object?>;
      expect(
        eventVocabulary.map(
          (event) => (event! as Map<String, Object?>)['event'],
        ),
        <String>[
          'resources-invalidated',
          'stream-gap',
          'authorization-revoked',
          'gateway-closing',
        ],
      );
      expect(
        jsonEncode(eventsOperation),
        isNot(anyOf(contains('handoffNotes'), contains('providerSessionId'))),
      );
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
          'agentTerminalAvailable',
          'agentErrorSummary',
          'labels',
          'dependencies',
          'dependentTasks',
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
            body: jsonEncode(fixtures['taskCreate']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['taskDetail']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['taskCompleteResult']),
          ),
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(fixtures['taskDeleteReceipt']),
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
      final created = await client.createCompanionTask(
        projectId: 'P-4',
        initialPrompt: 'Investigate mobile creation',
        credential: approval.credential!,
      );
      final detail = await client.getCompanionTaskDetail(
        taskId: 'KVG-2946',
        credential: approval.credential!,
      );
      final completed = await client.completeCompanionTask(
        taskId: 'KVG-2946',
        credential: approval.credential!,
      );
      final deleted = await client.deleteCompanionBacklogTask(
        taskId: 'KVG-3032',
        credential: approval.credential!,
      );
      final eventRequest = client.streamCompanionEvents(
        credential: approval.credential!,
        lastEventId: 'epoch:12',
      );
      final eventRequestWithoutCursor = client.streamCompanionEvents(
        credential: approval.credential!,
      );

      expect(status.hostId, '65d91f21-6732-45a6-9418-3dfaf4c93f52');
      expect(status.protocolVersion, 1);
      expect(attention.items.single.taskId, 'KVG-2945');
      expect(attention.items.single.projectName, 'OpenForge');
      expect(attention.items.single.state, 'needs-input');
      expect(created.taskId, 'KVG-3093');
      expect(created.projectId, 'P-4');
      expect(created.boardStatus, 'backlog');
      expect(detail.title, 'Add mobile Task detail');
      expect(detail.boardStatus, 'doing');
      expect(detail.handoffNotes, 'Ready for review.');
      expect(detail.agentState, 'failed');
      expect(detail.agentTerminalAvailable, isTrue);
      expect(detail.labels, <String>['mobile', 'review']);
      expect(detail.dependencies.single.taskId, 'KVG-2944');
      expect(detail.dependencies.single.boardStatus, 'done');
      expect(detail.dependentTasks.single.taskId, 'KVG-2947');
      expect(detail.dependentTasks.single.remainingDependencyCount, 1);
      expect(completed.taskId, 'KVG-2946');
      expect(completed.boardStatus, 'done');
      expect(completed.cleanupScheduled, isTrue);
      expect(deleted.taskId, 'KVG-3030');
      expect(deleted.outcome, 'deleted');
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
      expect(
        transport.requests[2].headers['openforge-companion-protocol-version'],
        '1',
      );
      expect(transport.requests[3].uri.path, '/companion/v1/attention');
      expect(
        transport.requests[3].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(
        transport.requests[3].headers['openforge-companion-protocol-version'],
        '1',
      );
      expect(transport.requests[4].method, 'POST');
      expect(
        transport.requests[4].uri.path,
        '/companion/v1/projects/P-4/tasks',
      );
      expect(jsonDecode(transport.requests[4].body!), <String, Object?>{
        'initialPrompt': 'Investigate mobile creation',
      });
      expect(
        transport.requests[4].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(transport.requests[5].uri.path, '/companion/v1/tasks/KVG-2946');
      expect(
        transport.requests[5].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(
        transport.requests[5].headers['openforge-companion-protocol-version'],
        '1',
      );
      expect(transport.requests[6].method, 'POST');
      expect(
        transport.requests[6].uri.path,
        '/companion/v1/tasks/KVG-2946/complete',
      );
      expect(
        transport.requests[6].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(transport.requests[7].method, 'POST');
      expect(
        transport.requests[7].uri.path,
        '/companion/v1/tasks/KVG-3032/delete',
      );
      expect(eventRequest.method, 'GET');
      expect(eventRequest.uri.path, '/companion/v1/events');
      expect(eventRequest.headers, <String, String>{
        'accept': 'text/event-stream',
        'authorization': 'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
        'openforge-companion-protocol-version': '1',
        'last-event-id': 'epoch:12',
      });
      expect(
        eventRequestWithoutCursor.headers,
        isNot(contains('last-event-id')),
      );
      expect(transport.requests, hasLength(8));
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

  test(
    'application client seam exposes pinned Project catalog and Board reads',
    () async {
      final transport = _RecordingTransport()
        ..responses = <CompanionV1HttpResponse>[
          const CompanionV1HttpResponse(
            statusCode: 200,
            body:
                '{"snapshotAt":"2026-08-01T12:00:00Z","projects":[{"projectId":"P-4","name":"OpenForge"}]}',
          ),
          const CompanionV1HttpResponse(
            statusCode: 200,
            body:
                '{"snapshotAt":"2026-08-01T12:00:01Z","projectId":"P-4","projectName":"OpenForge","counts":{"focus":0,"inFlight":0,"outOfFocus":0,"backlog":0},"lanes":{"focus":[],"inFlight":[],"outOfFocus":[],"backlog":[]}}',
          ),
        ];
      final client = GeneratedCompanionClient(
        transportFactory: (_) =>
            CompanionEndpointTransport(transport: transport, close: () {}),
      );
      final trust = CompanionTrustRecord(
        hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        certificateSha256: 'trusted-pin',
        endpointCandidates: <Uri>[Uri.parse('https://openforge.tailnet:17424')],
        deviceId: 'device-1',
        deviceCredential: 'credential-1',
      );

      final catalog = await client.fetchProjectCatalog(trust);
      final board = await client.fetchProjectBoard(trust, 'P-4');

      expect(catalog.projects.single.name, 'OpenForge');
      expect(board.projectId, 'P-4');
      expect(transport.requests.map((request) => request.uri.path), <String>[
        '/companion/v1/projects',
        '/companion/v1/projects/P-4/board',
      ]);
      expect(
        transport.requests.every(
          (request) =>
              request.headers['authorization'] == 'Bearer credential-1',
        ),
        isTrue,
      );
    },
  );
  test(
    'Complete makes one request and never falls through to another endpoint',
    () async {
      final requests = <({Uri uri, Map<String, String> headers})>[];
      final transport = _EndpointTransport(<String, Object>{
        '192.168.1.20': const SocketException('uncertain response'),
        'openforge.tailnet': const CompanionV1HttpResponse(
          statusCode: 200,
          body:
              '{"taskId":"KVG-3033","boardStatus":"done","cleanupScheduled":false}',
        ),
      }, requests: requests);
      final client = GeneratedCompanionClient(
        transportFactory: (_) =>
            CompanionEndpointTransport(transport: transport, close: () {}),
      );
      final trust = CompanionTrustRecord(
        hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        certificateSha256: 'trusted-pin',
        endpointCandidates: <Uri>[
          Uri.parse('https://192.168.1.20:17424'),
          Uri.parse('https://openforge.tailnet:17424'),
        ],
        deviceId: 'device-1',
        deviceCredential: 'credential-1',
      );

      await expectLater(
        client.completeTask(trust, 'KVG-3033'),
        throwsA(isA<SocketException>()),
      );
      expect(requests, hasLength(1));
      expect(requests.single.uri.host, '192.168.1.20');
      expect(requests.single.uri.path, '/companion/v1/tasks/KVG-3033/complete');
    },
  );

  test('Task Delete never retries across endpoint candidates', () async {
    final requests = <({Uri uri, Map<String, String> headers})>[];
    final transport = _EndpointTransport(<String, Object>{
      '192.168.1.20': const SocketException('uncertain outcome'),
      'openforge.tailnet': const CompanionV1HttpResponse(
        statusCode: 200,
        body: '{"taskId":"T-1","outcome":"deleted"}',
      ),
    }, requests: requests);
    final client = GeneratedCompanionClient(
      transportFactory: (_) =>
          CompanionEndpointTransport(transport: transport, close: () {}),
    );
    final trust = CompanionTrustRecord(
      hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
      certificateSha256: 'trusted-pin',
      endpointCandidates: <Uri>[
        Uri.parse('https://192.168.1.20:17424'),
        Uri.parse('https://openforge.tailnet:17424'),
      ],
      deviceId: 'device-1',
      deviceCredential: 'credential-1',
    );

    await expectLater(
      client.deleteBacklogTask(trust, 'T-1'),
      throwsA(isA<SocketException>()),
    );
    expect(requests, hasLength(1));
    expect(requests.single.uri.host, '192.168.1.20');
    expect(requests.single.uri.path, '/companion/v1/tasks/T-1/delete');
  });

  test(
    'Task mutations reject missing endpoints before opening transport',
    () async {
      var transportsOpened = 0;
      final client = GeneratedCompanionClient(
        transportFactory: (_) {
          transportsOpened += 1;
          return CompanionEndpointTransport(
            transport: _RecordingTransport(),
            close: () {},
          );
        },
      );
      final trust = CompanionTrustRecord(
        hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        certificateSha256: 'trusted-pin',
        endpointCandidates: const <Uri>[],
        deviceId: 'device-1',
        deviceCredential: 'credential-1',
      );
      final mutations = <Future<Object> Function()>[
        () => client.createTask(trust, 'P-4', 'Investigate mobile creation'),
        () => client.startTask(trust, 'T-1'),
        () => client.deleteBacklogTask(trust, 'T-1'),
        () => client.completeTask(trust, 'T-1'),
      ];

      for (final mutate in mutations) {
        await expectLater(
          mutate(),
          throwsA(
            isA<StateError>().having(
              (error) => error.message,
              'message',
              'No Companion endpoint candidates are available.',
            ),
          ),
        );
      }
      expect(transportsOpened, 0);
    },
  );

  test(
    'Task mutations use the preferred endpoint once and close failed transports',
    () async {
      final mutations = <_TaskMutation>[
        (
          path: '/companion/v1/projects/P-4/tasks',
          run: (client, trust) =>
              client.createTask(trust, 'P-4', 'Investigate mobile creation'),
        ),
        (
          path: '/companion/v1/tasks/T-1/start',
          run: (client, trust) => client.startTask(trust, 'T-1'),
        ),
        (
          path: '/companion/v1/tasks/T-1/delete',
          run: (client, trust) => client.deleteBacklogTask(trust, 'T-1'),
        ),
        (
          path: '/companion/v1/tasks/T-1/complete',
          run: (client, trust) => client.completeTask(trust, 'T-1'),
        ),
      ];

      for (final mutation in mutations) {
        final requests = <({Uri uri, Map<String, String> headers})>[];
        final outcomes = <String, Object>{
          '192.168.1.20': const SocketException('unreachable'),
          'openforge.tailnet': <Object>[
            const CompanionV1HttpResponse(
              statusCode: 200,
              body:
                  '{"hostId":"65d91f21-6732-45a6-9418-3dfaf4c93f52","protocolVersion":1,"serverTime":"2026-08-01T12:00:00Z"}',
            ),
            const SocketException('uncertain mutation outcome'),
          ],
        };
        var closes = 0;
        final client = GeneratedCompanionClient(
          transportFactory: (_) => CompanionEndpointTransport(
            transport: _EndpointTransport(outcomes, requests: requests),
            close: () => closes += 1,
          ),
        );
        final trust = CompanionTrustRecord(
          hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
          certificateSha256: 'trusted-pin',
          endpointCandidates: <Uri>[
            Uri.parse('https://192.168.1.20:17424'),
            Uri.parse('https://openforge.tailnet:17424'),
          ],
          deviceId: 'device-1',
          deviceCredential: 'credential-1',
        );
        await client.fetchHostStatus(trust);
        requests.clear();
        closes = 0;

        await expectLater(
          mutation.run(client, trust),
          throwsA(isA<SocketException>()),
        );

        expect(requests, hasLength(1), reason: mutation.path);
        expect(requests.single.uri.host, 'openforge.tailnet');
        expect(requests.single.uri.path, mutation.path);
        expect(closes, 1, reason: mutation.path);
      }
    },
  );

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
    'Complete uses the last healthy MagicDNS endpoint once after LAN fallback',
    () async {
      final outcomes = <String, Object>{
        '192.168.1.20': const SocketException('unreachable'),
        'forge-mac.example.ts.net': <Object>[
          CompanionV1HttpResponse(
            statusCode: 200,
            body: jsonEncode(<String, Object>{
              'hostId': '65d91f21-6732-45a6-9418-3dfaf4c93f52',
              'protocolVersion': 1,
              'serverTime': '2026-07-30T12:00:01Z',
            }),
          ),
          const CompanionV1HttpResponse(
            statusCode: 200,
            body:
                '{"taskId":"KVG-3033","boardStatus":"done","cleanupScheduled":false}',
          ),
        ],
      };
      final pins = <String>[];
      final requests = <({Uri uri, Map<String, String> headers})>[];
      final client = GeneratedCompanionClient(
        transportFactory: (certificateSha256) {
          pins.add(certificateSha256);
          return CompanionEndpointTransport(
            transport: _EndpointTransport(outcomes, requests: requests),
            close: () {},
          );
        },
      );
      final trustRecord = CompanionTrustRecord(
        hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        certificateSha256: 'trusted-pin',
        endpointCandidates: <Uri>[
          Uri.parse('https://192.168.1.20:17424'),
          Uri.parse('https://forge-mac.example.ts.net:17424'),
        ],
        deviceId: 'device-1',
        deviceCredential: 'credential-1',
      );

      final connection = await client.fetchHostStatus(trustRecord);
      final completed = await client.completeTask(trustRecord, 'KVG-3033');
      expect(
        connection.endpoint,
        Uri.parse('https://forge-mac.example.ts.net:17424'),
      );
      expect(connection.status.hostId, trustRecord.hostId);
      expect(completed.boardStatus, 'done');
      expect(pins, <String>['trusted-pin', 'trusted-pin', 'trusted-pin']);
      expect(requests, hasLength(3));
      expect(requests.last.headers['authorization'], 'Bearer credential-1');
      expect(requests.last.uri.host, 'forge-mac.example.ts.net');
      expect(requests.last.uri.path, '/companion/v1/tasks/KVG-3033/complete');
    },
  );

  test(
    'pairing bounds unreachable LAN candidates and reaches pinned Tailscale',
    () async {
      final never = Completer<CompanionV1HttpResponse>().future;
      final tailscaleResponse = CompanionV1HttpResponse(
        statusCode: 202,
        body: jsonEncode(<String, Object>{
          'requestId': '50b26936-55a7-48e5-a1c7-65eaf08211ee',
          'status': 'pending',
          'expiresAt': DateTime.now()
              .add(const Duration(minutes: 1))
              .toUtc()
              .toIso8601String(),
        }),
      );
      const approvalResponse = CompanionV1HttpResponse(
        statusCode: 200,
        body:
            '{"status":"approved","deviceId":"50b26936-55a7-48e5-a1c7-65eaf08211ee","credential":"BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"}',
      );
      const hostStatusResponse = CompanionV1HttpResponse(
        statusCode: 200,
        body:
            '{"hostId":"65d91f21-6732-45a6-9418-3dfaf4c93f52","protocolVersion":1,"serverTime":"2026-08-01T09:00:00Z"}',
      );
      final outcomes = <String, Object>{
        '192.168.1.20': never,
        '192.168.1.21': never,
        'fe80::1': never,
        '10.0.0.7': never,
        'forge-mac.example.ts.net': <Object>[
          tailscaleResponse,
          approvalResponse,
          hostStatusResponse,
        ],
      };
      final attempts = <String>[];
      final pins = <String>[];
      var closes = 0;
      final client = GeneratedCompanionClient(
        pairingCandidateTimeout: const Duration(milliseconds: 10),
        pairingOverallTimeout: const Duration(milliseconds: 250),
        transportFactory: (certificateSha256) {
          pins.add(certificateSha256);
          return CompanionEndpointTransport(
            transport: _EndpointTransport(outcomes),
            close: () => closes += 1,
          );
        },
      );
      final bootstrap = PairingBootstrap(
        protocolVersion: 1,
        hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
        certificateSha256: 'trusted-pin',
        endpointCandidates: <Uri>[
          Uri.parse('https://192.168.1.20:17424'),
          Uri.parse('https://192.168.1.21:17424'),
          Uri.parse('https://[fe80::1]:17424'),
          Uri.parse('https://10.0.0.7:17424'),
          Uri.parse('https://forge-mac.example.ts.net:17424'),
        ],
        oneTimeSecret: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      );
      final stopwatch = Stopwatch()..start();

      final submission = await client.submitPairing(
        bootstrap: bootstrap,
        deviceName: 'Pixel 9',
        platform: 'android',
        onDiagnostic: attempts.add,
      );
      stopwatch.stop();
      final approval = await client.pollPairing(
        bootstrap: bootstrap,
        requestId: submission.requestId,
        onDiagnostic: attempts.add,
      );
      final connection = await client.fetchHostStatus(
        CompanionTrustRecord(
          hostId: bootstrap.hostId,
          certificateSha256: bootstrap.certificateSha256,
          endpointCandidates: bootstrap.endpointCandidates,
          deviceId: approval.deviceId!,
          deviceCredential: approval.credential!,
        ),
      );

      expect(submission.requestId, '50b26936-55a7-48e5-a1c7-65eaf08211ee');
      expect(approval.status, 'approved');
      expect(connection.endpoint.host, 'forge-mac.example.ts.net');
      expect(stopwatch.elapsed, lessThan(const Duration(milliseconds: 200)));
      expect(pins, hasLength(7));
      expect(pins, everyElement('trusted-pin'));
      expect(closes, 7);
      expect(
        attempts,
        containsAllInOrder(<String>[
          'endpoint started: https://192.168.1.20:17424',
          'endpoint timed out: https://192.168.1.20:17424 after 10ms',
          'endpoint started: https://192.168.1.21:17424',
          'endpoint timed out: https://192.168.1.21:17424 after 10ms',
          'endpoint started: https://[fe80::1]:17424',
          'endpoint timed out: https://[fe80::1]:17424 after 10ms',
          'endpoint started: https://10.0.0.7:17424',
          'endpoint timed out: https://10.0.0.7:17424 after 10ms',
          'endpoint started: https://forge-mac.example.ts.net:17424',
          'endpoint succeeded: https://forge-mac.example.ts.net:17424',
          'endpoint started: https://forge-mac.example.ts.net:17424',
          'endpoint succeeded: https://forge-mac.example.ts.net:17424',
        ]),
      );
      expect(attempts.join('\n'), isNot(contains(bootstrap.oneTimeSecret)));
    },
  );

  test(
    'MagicDNS certificate mismatch wins when no trusted candidate connects',
    () async {
      final outcomes = <String, Object>{
        '192.168.1.20': const SocketException('unreachable'),
        'forge-mac.example.ts.net': const CompanionCertificateMismatch(),
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
          Uri.parse('https://forge-mac.example.ts.net:17424'),
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
