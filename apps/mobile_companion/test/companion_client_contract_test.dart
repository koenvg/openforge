import 'dart:convert';
import 'dart:io';

import 'package:crypto/crypto.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/companion_transport_fixtures.dart';

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
      expect(encodedContract, contains('getCompanionTaskPromptCatalog'));
      expect(encodedContract, contains('createCompanionTask'));
      expect(encodedContract, contains('getCompanionTaskDetail'));
      expect(encodedContract, contains('completeCompanionTask'));
      expect(encodedContract, contains('startCompanionTask'));
      expect(encodedContract, contains('deleteCompanionBacklogTask'));
      expect(encodedContract, contains('streamCompanionEvents'));
      expect(encodedContract, contains('getCompanionTaskActions'));
      expect(encodedContract, contains('getCompanionProjectActions'));
      expect(encodedContract, contains('setAsideCompanionTask'));
      expect(encodedContract, contains('returnCompanionTaskToBoard'));
      expect(encodedContract, contains('mergeCompanionTaskPullRequest'));
      expect(encodedContract, contains('enqueueCompanionTaskPullRequest'));
      expect(encodedContract, contains('runCompanionTaskApp'));
      expect(encodedContract, contains('refreshCompanionGithub'));
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
          '/projects/{projectId}/task-prompt-catalog',
          '/projects/{projectId}/tasks',
          '/tasks/{taskId}',
          '/tasks/{taskId}/complete',
          '/tasks/{taskId}/start',
          '/tasks/{taskId}/delete',
          '/tasks/{taskId}/actions',
          '/tasks/{taskId}/set-aside',
          '/tasks/{taskId}/return-to-board',
          '/tasks/{taskId}/merge',
          '/tasks/{taskId}/enqueue',
          '/tasks/{taskId}/run-app',
          '/projects/{projectId}/actions',
          '/refresh-github',
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
      expect(jsonEncode(eventsOperation), isNot(contains('providerSessionId')));
      final components = contract['components']! as Map<String, Object?>;
      final schemas = components['schemas']! as Map<String, Object?>;
      final detailSchema = schemas['TaskDetail']! as Map<String, Object?>;
      final detailProperties =
          detailSchema['properties']! as Map<String, Object?>;
      expect(
        detailProperties.keys,
        unorderedEquals(<String>[
          'taskId',
          'initialPrompt',
          'title',
          'projectId',
          'projectName',
          'boardStatus',
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

      final transport = RecordingCompanionTransport()
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
      expect(status.protocolVersion, 3);
      expect(attention.items.single.taskId, 'KVG-2945');
      expect(attention.items.single.projectName, 'OpenForge');
      expect(attention.items.single.state, 'needs-input');
      expect(created.taskId, 'KVG-3093');
      expect(created.projectId, 'P-4');
      expect(created.boardStatus, 'backlog');
      expect(detail.initialPrompt, contains('Render the **full** prompt'));
      expect(detail.title, 'Add mobile Task detail');
      expect(detail.boardStatus, 'doing');
      expect(detail.agentState, 'failed');
      expect(detail.agentTerminalAvailable, isTrue);
      expect(detail.labels, <String>['mobile', 'review']);
      expect(detail.dependencies.single.taskId, 'KVG-2944');
      expect(detail.dependencies.single.boardStatus, 'done');
      expect(detail.dependencies.single.projectId, 'P-5');
      expect(detail.dependencies.single.projectName, 'Release Tools');
      expect(detail.dependentTasks.single.taskId, 'KVG-2947');
      expect(detail.dependentTasks.single.projectId, 'P-5');
      expect(detail.dependentTasks.single.projectName, 'Release Tools');
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
        '3',
      );
      expect(transport.requests[3].uri.path, '/companion/v1/attention');
      expect(
        transport.requests[3].headers['authorization'],
        'Bearer BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
      );
      expect(
        transport.requests[3].headers['openforge-companion-protocol-version'],
        '3',
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
        '3',
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
        'openforge-companion-protocol-version': '3',
        'last-event-id': 'epoch:12',
      });
      expect(
        eventRequestWithoutCursor.headers,
        isNot(contains('last-event-id')),
      );
      expect(transport.requests, hasLength(8));
    },
  );

  test(
    'generated GitHub refresh uses the global route and explicit authorization',
    () async {
      final transport = RecordingCompanionTransport()
        ..responses = <CompanionV1HttpResponse>[
          CompanionV1HttpResponse(statusCode: 204, body: '{}'),
        ];
      final client = CompanionV1Client(
        baseUrl: Uri.parse('https://desktop.local'),
        transport: transport,
      );

      await client.refreshCompanionGithub(credential: 'credential-1');

      final request = transport.requests.single;
      expect(request.method, 'POST');
      expect(request.uri.path, '/companion/v1/refresh-github');
      expect(request.headers, <String, String>{
        'authorization': 'Bearer credential-1',
        'openforge-companion-protocol-version': '3',
      });
      expect(request.body, isNull);
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
        'protocolVersion': 3,
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
      final transport = RecordingCompanionTransport()
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
}
