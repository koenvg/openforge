import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';

void main() {
  testWidgets('launches into an accessible unpaired screen', (tester) async {
    await tester.pumpWidget(const CompanionApp());

    expect(find.text('Not paired'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Connection state: Not paired'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Pair with desktop'), findsOneWidget);
  });

  testWidgets('pairing action is an honest placeholder', (tester) async {
    await tester.pumpWidget(const CompanionApp());

    await tester.tap(find.byKey(const Key('pair-with-desktop')));
    await tester.pump();

    expect(
      find.text('Pairing will be added in a later release.'),
      findsOneWidget,
    );
  });

  for (final scenario in <({CompanionConnectionState state, String title})>[
    (state: const Unpaired(), title: 'Not paired'),
    (state: const Pairing(), title: 'Pairing'),
    (state: const AwaitingApproval(), title: 'Awaiting desktop approval'),
    (state: const Connected(), title: 'Connected'),
    (state: const Reconnecting(), title: 'Reconnecting'),
    (state: const Unavailable(), title: 'Desktop unavailable'),
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
