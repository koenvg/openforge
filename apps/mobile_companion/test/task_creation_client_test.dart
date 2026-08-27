import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

final _trustRecord = CompanionTrustRecord(
  hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
  certificateSha256: 'trusted-pin',
  endpointCandidates: <Uri>[
    Uri.parse('https://192.168.1.20:17424'),
    Uri.parse('https://openforge.tailnet:17424'),
  ],
  deviceId: 'device-1',
  deviceCredential: 'credential-1',
);

final class _RecordingTransport implements CompanionV1Transport {
  _RecordingTransport(this.outcome);

  final Object outcome;
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
    if (outcome is Exception) throw outcome;
    return outcome as CompanionV1HttpResponse;
  }
}

void main() {
  test('Task prompt catalog uses an authenticated Project read', () async {
    final transport = _RecordingTransport(
      const CompanionV1HttpResponse(
        statusCode: 200,
        body:
            '{"provider":"pi","trigger":"/","suggestions":[{"name":"skill:review","description":"Review changes","kind":"skill","source":"skill"}]}',
      ),
    );
    final client = GeneratedCompanionClient(
      transportFactory: (_) =>
          CompanionEndpointTransport(transport: transport, close: () {}),
    );

    final catalog = await client.fetchTaskPromptCatalog(_trustRecord, 'P-4');

    expect(catalog.provider, 'pi');
    expect(catalog.trigger, '/');
    expect(catalog.suggestions.single.name, 'skill:review');
    expect(catalog.suggestions.single.kind, TaskPromptSuggestionKind.skill);
    expect(transport.requests, hasLength(1));
    final request = transport.requests.single;
    expect(request.method, 'GET');
    expect(request.uri.path, '/companion/v1/projects/P-4/task-prompt-catalog');
    expect(request.headers['authorization'], 'Bearer credential-1');
    expect(request.body, isNull);
  });

  test('Task creation makes one authenticated mutation attempt', () async {
    final transport = _RecordingTransport(
      const SocketException('response lost after request'),
    );
    final client = GeneratedCompanionClient(
      transportFactory: (_) =>
          CompanionEndpointTransport(transport: transport, close: () {}),
    );

    await expectLater(
      client.createTask(_trustRecord, 'P-4', 'Investigate mobile creation'),
      throwsA(isA<SocketException>()),
    );

    expect(transport.requests, hasLength(1));
    final request = transport.requests.single;
    expect(request.method, 'POST');
    expect(request.uri.host, '192.168.1.20');
    expect(request.uri.path, '/companion/v1/projects/P-4/tasks');
    expect(request.headers['authorization'], 'Bearer credential-1');
    expect(jsonDecode(request.body!), <String, Object?>{
      'initialPrompt': 'Investigate mobile creation',
    });
  });
  test(
    'Task creation returns the backend-authoritative backlog receipt',
    () async {
      final transport = _RecordingTransport(
        const CompanionV1HttpResponse(
          statusCode: 200,
          body: '{"taskId":"T-new","projectId":"P-4","boardStatus":"backlog"}',
        ),
      );
      final client = GeneratedCompanionClient(
        transportFactory: (_) =>
            CompanionEndpointTransport(transport: transport, close: () {}),
      );

      final created = await client.createTask(
        _trustRecord,
        'P-4',
        'Investigate mobile creation',
      );

      expect(created.taskId, 'T-new');
      expect(created.projectId, 'P-4');
      expect(created.boardStatus, 'backlog');
    },
  );
}
