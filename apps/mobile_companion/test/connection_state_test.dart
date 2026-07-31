import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';

void main() {
  test('models every connection state from the mobile design', () {
    const states = <CompanionConnectionState>[
      Unpaired(),
      Pairing(),
      AwaitingApproval(),
      Connected(),
      Reconnecting(),
      Unavailable(),
      Revoked(),
      CertificateMismatch(),
      IncompatibleProtocol(),
    ];

    expect(states, hasLength(9));
    expect(states.map((state) => state.runtimeType).toSet(), hasLength(9));
  });
}
