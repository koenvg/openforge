import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';

void main() {
  test('models every connection state from the mobile design', () {
    const states = <CompanionConnectionState>[
      Restoring(),
      Unpaired(),
      Pairing(),
      AwaitingApproval(),
      PairingRejected(),
      PairingUnavailable(),
      Connected(hostId: 'desktop-host-1', protocolVersion: 1),
      Reconnecting(),
      Unavailable(),
      Revoked(),
      CertificateMismatch(),
      IncompatibleProtocol(),
    ];

    expect(states, hasLength(12));
    expect(states.map((state) => state.runtimeType).toSet(), hasLength(12));
  });
}
