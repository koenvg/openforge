import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

final _trustRecord = CompanionTrustRecord(
  hostId: '65d91f21-6732-45a6-9418-3dfaf4c93f52',
  certificateSha256:
      '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A',
  endpointCandidates: <Uri>[
    Uri.parse('https://192.168.1.20:17424'),
    Uri.parse('https://100.64.0.10:17424'),
  ],
  deviceId: '50b26936-55a7-48e5-a1c7-65eaf08211ee',
  deviceCredential: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
);

final class _EndpointAwareTransport implements CompanionV1Transport {
  _EndpointAwareTransport(this.attemptedHosts);

  final List<String> attemptedHosts;

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    attemptedHosts.add(uri.host);
    if (uri.host == '192.168.1.20') {
      throw const SocketException('response lost');
    }
    if (uri.path == '/companion/v1/status') {
      return const CompanionV1HttpResponse(
        statusCode: 200,
        body:
            '{"hostId":"65d91f21-6732-45a6-9418-3dfaf4c93f52","protocolVersion":3,"serverTime":"2026-08-01T12:00:00Z"}',
      );
    }
    return const CompanionV1HttpResponse(
      statusCode: 200,
      body: '{"taskId":"KVG-3031","outcome":"started"}',
    );
  }
}

void main() {
  test(
    'Task Start never fails over or automatically retries after an uncertain outcome',
    () async {
      final attemptedHosts = <String>[];
      final client = GeneratedCompanionClient(
        transportFactory: (_) => CompanionEndpointTransport(
          transport: _EndpointAwareTransport(attemptedHosts),
          close: () {},
        ),
      );

      await expectLater(
        client.startTask(_trustRecord, 'KVG-3031'),
        throwsA(isA<SocketException>()),
      );
      expect(attemptedHosts, <String>['192.168.1.20']);
    },
  );
  test(
    'Task Start uses the established authenticated endpoint without failover',
    () async {
      final attemptedHosts = <String>[];
      final client = GeneratedCompanionClient(
        transportFactory: (_) => CompanionEndpointTransport(
          transport: _EndpointAwareTransport(attemptedHosts),
          close: () {},
        ),
      );
      await client.fetchHostStatus(_trustRecord);
      attemptedHosts.clear();

      final result = await client.startTask(_trustRecord, 'KVG-3031');

      expect(result.outcome, TaskStartOutcome.started);
      expect(attemptedHosts, <String>['100.64.0.10']);
    },
  );
}
