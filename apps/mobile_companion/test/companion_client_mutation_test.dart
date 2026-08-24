import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/companion_transport_fixtures.dart';

typedef _RunTaskMutation =
    Future<Object> Function(
      GeneratedCompanionClient client,
      CompanionTrustRecord trust,
    );
typedef _TaskMutation = ({String path, _RunTaskMutation run});

void main() {
  test(
    'Complete makes one request and never falls through to another endpoint',
    () async {
      final requests = <({Uri uri, Map<String, String> headers})>[];
      final transport = EndpointCompanionTransport(<String, Object>{
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
    final transport = EndpointCompanionTransport(<String, Object>{
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
            transport: RecordingCompanionTransport(),
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
                  '{"hostId":"65d91f21-6732-45a6-9418-3dfaf4c93f52","protocolVersion":3,"serverTime":"2026-08-01T12:00:00Z"}',
            ),
            const SocketException('uncertain mutation outcome'),
          ],
        };
        var closes = 0;
        final client = GeneratedCompanionClient(
          transportFactory: (_) => CompanionEndpointTransport(
            transport: EndpointCompanionTransport(outcomes, requests: requests),
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
              'protocolVersion': 3,
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
            transport: EndpointCompanionTransport(outcomes, requests: requests),
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
}
