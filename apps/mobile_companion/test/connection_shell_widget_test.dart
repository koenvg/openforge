import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';

void main() {
  testWidgets('revoked state exposes a re-pair recovery action', (
    tester,
  ) async {
    var reset = false;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const Revoked(),
          onReset: () => reset = true,
        ),
      ),
    );

    await tester.tap(find.text('Forget and pair again'));
    expect(reset, isTrue);
  });

  testWidgets('incompatible state retries after the user updates either app', (
    tester,
  ) async {
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const IncompatibleProtocol(),
          onRetry: () => retried = true,
        ),
      ),
    );

    await tester.tap(find.text('Check again'));

    expect(retried, isTrue);
  });

  testWidgets('local network denial opens app settings recovery', (
    tester,
  ) async {
    var openedSettings = false;
    var retried = false;
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const LocalNetworkPermissionDenied(),
          onOpenSettings: () => openedSettings = true,
          onRetry: () => retried = true,
        ),
      ),
    );

    await tester.tap(find.text('Open settings'));
    await tester.tap(find.text('Retry'));

    expect(openedSettings, isTrue);
    expect(retried, isTrue);
  });

  testWidgets('unpaired state presents focused secure pairing actions', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: ConnectionShell(
          state: const Unpaired(),
          onPair: () {},
          onManualPair: () {},
        ),
      ),
    );

    expect(find.text('Pair with your desktop'), findsOneWidget);
    expect(find.text('Scan pairing code'), findsOneWidget);
    expect(find.text('Enter code manually'), findsOneWidget);
    expect(find.text('Pinned, encrypted connection'), findsOneWidget);
  });

  for (final scenario in <({CompanionConnectionState state, String title})>[
    (state: const Restoring(), title: 'Restoring connection'),
    (state: const Unpaired(), title: 'Not paired'),
    (state: const Pairing(), title: 'Pairing'),
    (state: const AwaitingApproval(), title: 'Awaiting desktop approval'),
    (state: const PairingRejected(), title: 'Pairing rejected'),
    (state: const PairingUnavailable(), title: 'Pairing unavailable'),
    (
      state: const Connected(hostId: 'desktop-host-1', protocolVersion: 1),
      title: 'Connected',
    ),
    (state: const Reconnecting(), title: 'Reconnecting'),
    (state: const Unavailable(), title: 'Desktop unavailable'),
    (
      state: const LocalNetworkPermissionDenied(),
      title: 'Local network access needed',
    ),
    (state: const Revoked(), title: 'Re-pair required'),
    (state: const CertificateMismatch(), title: 'Certificate mismatch'),
    (state: const IncompatibleProtocol(), title: 'Update required'),
  ]) {
    testWidgets('${scenario.title} has a distinct semantic connection state', (
      tester,
    ) async {
      await tester.pumpWidget(CompanionApp(initialState: scenario.state));

      expect(find.text(scenario.title), findsOneWidget);
      expect(
        find.bySemanticsLabel('Connection state: ${scenario.title}'),
        findsOneWidget,
      );
    });
  }
}
