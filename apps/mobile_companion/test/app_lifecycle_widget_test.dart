import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

import 'support/widget_test_fakes.dart';

void main() {
  testWidgets('launches into an accessible unpaired screen', (tester) async {
    await tester.pumpWidget(const CompanionApp());

    expect(find.text('Not paired'), findsOneWidget);
    expect(
      find.textContaining(
        'Pairing lets this phone interact with running Agent terminals as your '
        'desktop user',
      ),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel('Connection state: Not paired'),
      findsOneWidget,
    );
  });

  testWidgets('pairing approval discloses interactive terminal authority', (
    tester,
  ) async {
    await tester.pumpWidget(
      const CompanionApp(initialState: AwaitingApproval()),
    );

    expect(
      find.textContaining(
        'Approval lets this phone interact with running Agent terminals',
      ),
      findsOneWidget,
    );
    expect(find.textContaining('desktop user'), findsOneWidget);
  });

  testWidgets(
    'replacing the pairing controller transfers state subscription ownership',
    (tester) async {
      final oldController = pairingController();
      final newController = pairingController()..liveUnavailable();

      await tester.pumpWidget(CompanionApp(controller: oldController));
      expect(find.text('Restoring connection'), findsOneWidget);

      await tester.pumpWidget(CompanionApp(controller: newController));
      expect(find.text('Desktop unavailable'), findsOneWidget);

      newController.authorizationLost();
      await tester.pump();
      expect(find.text('Re-pair required'), findsOneWidget);

      await tester.pumpWidget(const SizedBox.shrink());
      oldController.liveUnavailable();
      expect(tester.takeException(), isNull);

      oldController.dispose();
      newController.dispose();
    },
  );

  testWidgets(
    'connected state displays authenticated host identity and protocol',
    (tester) async {
      await tester.pumpWidget(
        const CompanionApp(
          initialState: Connected(hostId: 'desktop-host-1', protocolVersion: 1),
        ),
      );

      expect(find.text('Connected'), findsOneWidget);
      expect(
        find.textContaining('Interactive Agent terminal access is active'),
        findsOneWidget,
      );
      expect(find.text('Host desktop-host-1'), findsOneWidget);
      expect(find.text('Companion protocol v1'), findsOneWidget);
      expect(
        find.bySemanticsLabel('Connection state: Connected'),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'losing the desktop removes an open Task and its domain content',
    (tester) async {
      final storage = MemoryCompanionStorage(trustRecord);
      final client = DomainCompanionClient();
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
      );
      final attention = AttentionController(client: client, storage: storage);
      await pairing.restore();
      await attention.refresh();

      await tester.pumpWidget(
        CompanionApp(
          controller: pairing,
          attentionController: attention,
          taskDetailControllerFactory: (taskId) => TaskDetailController(
            taskId: taskId,
            client: client,
            storage: storage,
          ),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.text('Sensitive Task'));
      await tester.pumpAndSettle();
      expect(find.text('Private Handoff Notes'), findsOneWidget);

      pairing.liveUnavailable();
      await tester.pumpAndSettle();

      expect(find.text('Desktop unavailable'), findsOneWidget);
      expect(find.text('Sensitive Task'), findsNothing);
      expect(find.text('Private Handoff Notes'), findsNothing);
    },
  );
}
