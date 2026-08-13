import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

final class _QueueTransport implements CompanionV1Transport {
  _QueueTransport(this.responses);

  final List<CompanionV1HttpResponse> responses;
  final requests = <({String method, Uri uri, Map<String, String> headers})>[];

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    requests.add((method: method, uri: uri, headers: headers));
    return responses.removeAt(0);
  }
}

void main() {
  test(
    'generated Project catalog and Board decoders match shared fixtures',
    () async {
      final fixtures =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1-fixtures.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final transport = _QueueTransport(<CompanionV1HttpResponse>[
        CompanionV1HttpResponse(
          statusCode: 200,
          body: jsonEncode(fixtures['projectCatalog']),
        ),
        CompanionV1HttpResponse(
          statusCode: 200,
          body: jsonEncode(fixtures['projectBoard']),
        ),
      ]);
      final client = CompanionV1Client(
        baseUrl: Uri.parse('https://192.168.1.20:17424'),
        transport: transport,
      );

      final catalog = await client.getCompanionProjects(
        credential: 'credential',
      );
      final board = await client.getCompanionProjectBoard(
        projectId: 'P-4',
        credential: 'credential',
      );

      expect(catalog.projects.map((project) => project.projectId), <String>[
        'P-4',
        'P-2',
      ]);
      expect(catalog.projects.first.name, 'OpenForge');
      expect(board.projectId, 'P-4');
      expect(board.projectName, 'OpenForge');
      expect(board.counts.focus, 1);
      expect(board.counts.inFlight, 1);
      expect(board.counts.outOfFocus, 1);
      expect(board.counts.backlog, 1);
      expect(board.lanes.focus.single.lane, ProjectBoardLane.focus);
      expect(board.lanes.inFlight.single.lane, ProjectBoardLane.inFlight);
      expect(board.lanes.outOfFocus.single.lane, ProjectBoardLane.outOfFocus);
      expect(board.lanes.backlog.single.lane, ProjectBoardLane.backlog);
      expect(transport.requests[0].uri.path, '/companion/v1/projects');
      expect(
        transport.requests[1].uri.path,
        '/companion/v1/projects/P-4/board',
      );
      expect(
        transport.requests.every(
          (request) =>
              request.headers['openforge-companion-protocol-version'] == '2',
        ),
        isTrue,
      );
      final encoded = jsonEncode(fixtures['projectBoard']);
      for (final sensitive in <String>[
        'filesystemPath',
        'initialPrompt',
        'handoffNotes',
        'provider',
        'sessionId',
      ]) {
        expect(encoded, isNot(contains(sensitive)));
      }
    },
  );

  test(
    'generated Board and invalidation decoders reject unsafe or malformed shapes',
    () {
      expect(
        () => ProjectBoardTask.fromJson(<String, Object?>{
          'taskId': 'T-1',
          'title': 'Task',
          'lane': 'unknown',
          'state': 'idle',
          'reason': 'Ready.',
          'activityAt': '2026-08-01T12:00:00Z',
        }),
        throwsFormatException,
      );
      final invalidation = ResourceInvalidationData.fromJson(<String, Object?>{
        'resources': <Object?>[
          <String, Object?>{'kind': 'project_catalog'},
          <String, Object?>{'kind': 'project_board', 'id': 'P-4'},
        ],
      });
      expect(
        invalidation.resources.first,
        isA<ProjectCatalogResourceIdentityData>(),
      );
      expect(
        invalidation.resources.last,
        isA<ProjectBoardResourceIdentityData>(),
      );
    },
  );

  test('generated client sends the explicit Task Delete operation', () async {
    final fixtures =
        jsonDecode(
              File(
                '../../docs/contracts/companion-v1-fixtures.json',
              ).readAsStringSync(),
            )
            as Map<String, Object?>;
    final transport = _QueueTransport(<CompanionV1HttpResponse>[
      CompanionV1HttpResponse(
        statusCode: 200,
        body: jsonEncode(fixtures['taskDeleteReceipt']),
      ),
    ]);
    final client = CompanionV1Client(
      baseUrl: Uri.parse('https://192.168.1.20:17424'),
      transport: transport,
    );

    final receipt = await client.deleteCompanionBacklogTask(
      taskId: 'KVG-3030',
      credential: 'credential',
    );

    expect(receipt.taskId, 'KVG-3030');
    expect(receipt.outcome, 'deleted');
    expect(transport.requests.single.method, 'POST');
    expect(
      transport.requests.single.uri.path,
      '/companion/v1/tasks/KVG-3030/delete',
    );
    expect(
      transport.requests.single.headers['openforge-companion-protocol-version'],
      '2',
    );
  });
}
