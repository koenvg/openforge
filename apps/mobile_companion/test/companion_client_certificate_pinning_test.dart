import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

import 'support/companion_transport_fixtures.dart';

void main() {
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
    'MagicDNS certificate mismatch wins when no trusted candidate connects',
    () async {
      final outcomes = <String, Object>{
        '192.168.1.20': const SocketException('unreachable'),
        'forge-mac.example.ts.net': const CompanionCertificateMismatch(),
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
}
