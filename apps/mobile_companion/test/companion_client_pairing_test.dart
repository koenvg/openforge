import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/companion_transport_fixtures.dart';

void main() {
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
            '{"hostId":"65d91f21-6732-45a6-9418-3dfaf4c93f52","protocolVersion":3,"serverTime":"2026-08-01T09:00:00Z"}',
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
            transport: EndpointCompanionTransport(outcomes),
            close: () => closes += 1,
          );
        },
      );
      final bootstrap = PairingBootstrap(
        protocolVersion: 3,
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
}
