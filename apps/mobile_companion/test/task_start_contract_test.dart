import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

final class _RecordingTransport implements CompanionV1Transport {
  _RecordingTransport(this.responses);

  final List<CompanionV1HttpResponse> responses;
  final requests =
      <({String method, Uri uri, Map<String, String> headers, String? body})>[];

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

void main() {
  test(
    'checked-in contract exposes explicit identity-only Companion Task Start',
    () async {
      final contract =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1.openapi.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final paths = contract['paths']! as Map<String, Object?>;
      final startPath = paths['/tasks/{taskId}/start']! as Map<String, Object?>;
      final operation = startPath['post']! as Map<String, Object?>;

      expect(operation['operationId'], 'startCompanionTask');
      expect(operation, isNot(contains('requestBody')));
      expect(startPath.keys, <String>['post']);
      expect(jsonEncode(paths), isNot(contains('genericInvoke')));
      expect(jsonEncode(paths), isNot(contains('workspacePath')));
      expect(jsonEncode(paths), isNot(contains('providerOptions')));
    },
  );

  test(
    'generated client sends one bodyless Task-scoped mutation and decodes result',
    () async {
      final fixtures =
          jsonDecode(
                File(
                  '../../docs/contracts/companion-v1-fixtures.json',
                ).readAsStringSync(),
              )
              as Map<String, Object?>;
      final transport = _RecordingTransport(<CompanionV1HttpResponse>[
        CompanionV1HttpResponse(
          statusCode: 200,
          body: jsonEncode(fixtures['taskStart']),
        ),
      ]);
      final client = CompanionV1Client(
        baseUrl: Uri.parse('https://192.168.1.20:17424'),
        transport: transport,
      );

      final result = await client.startCompanionTask(
        taskId: 'KVG-3031',
        credential: 'credential',
      );

      expect(result.taskId, 'KVG-3031');
      expect(result.outcome, TaskStartOutcome.started);
      expect(transport.requests, hasLength(1));
      expect(transport.requests.single.method, 'POST');
      expect(
        transport.requests.single.uri.path,
        '/companion/v1/tasks/KVG-3031/start',
      );
      expect(transport.requests.single.body, isNull);
      expect(
        transport
            .requests
            .single
            .headers['openforge-companion-protocol-version'],
        '2',
      );
    },
  );

  test('generated client preserves stable Task Start error codes', () async {
    for (final code in <String>[
      'invalid_state',
      'operation_in_progress',
      'desktop_action_required',
    ]) {
      final transport = _RecordingTransport(<CompanionV1HttpResponse>[
        CompanionV1HttpResponse(
          statusCode: 409,
          body: jsonEncode(<String, Object?>{
            'error': <String, Object?>{
              'code': code,
              'message': 'Safe message',
              'requestId': null,
            },
          }),
        ),
      ]);
      final client = CompanionV1Client(
        baseUrl: Uri.parse('https://192.168.1.20:17424'),
        transport: transport,
      );

      await expectLater(
        client.startCompanionTask(taskId: 'KVG-3031', credential: 'credential'),
        throwsA(
          isA<CompanionV1Exception>().having(
            (error) => error.code,
            'code',
            code,
          ),
        ),
      );
    }
  });
}
