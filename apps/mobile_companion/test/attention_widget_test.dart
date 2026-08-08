import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/attention/attention_home.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

void main() {
  testWidgets('attention home groups minimal Task context by Project', (
    tester,
  ) async {
    final snapshot = AttentionSnapshot(
      snapshotAt: DateTime.utc(2026, 7, 30, 12),
      items: <AttentionItem>[
        AttentionItem(
          taskId: 'T-2',
          projectId: 'P-1',
          projectName: 'Alpha',
          title: 'Review agent question',
          state: 'needs-input',
          reason: 'Agent needs your input to continue.',
          activityAt: DateTime.utc(2026, 7, 30, 11, 59),
        ),
        AttentionItem(
          taskId: 'T-3',
          projectId: 'P-2',
          projectName: 'Beta',
          title: 'Inspect failed change',
          state: 'failed',
          reason: 'Agent failed — check the error log.',
          activityAt: DateTime.utc(2026, 7, 30, 11, 58),
        ),
      ],
    );

    await tester.pumpWidget(
      MaterialApp(
        home: AttentionHome(
          state: AttentionLoaded(snapshot),
          onRefresh: () async {},
        ),
      ),
    );

    expect(find.text('Alpha'), findsOneWidget);
    expect(find.text('Beta'), findsOneWidget);
    expect(find.text('Review agent question'), findsOneWidget);
    expect(find.text('Needs input'), findsOneWidget);
    expect(find.text('Agent needs your input to continue.'), findsOneWidget);
    final taskSemantics = find.bySemanticsLabel(
      RegExp(
        r'^Task Review agent question, Needs input, Agent needs your input to continue\.,',
      ),
    );
    expect(taskSemantics, findsOneWidget);
    expect(tester.getSemantics(taskSemantics).label, contains('Jul 30'));
  });

  testWidgets(
    'attention home exposes accessible loading and calm empty states',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: AttentionHome(
            state: const AttentionLoading(),
            onRefresh: () async {},
          ),
        ),
      );
      expect(
        find.bySemanticsLabel('Loading Tasks that need attention'),
        findsOneWidget,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: AttentionHome(
            state: AttentionLoaded(
              AttentionSnapshot(
                snapshotAt: DateTime.utc(2026, 7, 30),
                items: const <AttentionItem>[],
              ),
            ),
            onRefresh: () async {},
          ),
        ),
      );
      expect(find.text("You're all caught up"), findsOneWidget);
      expect(find.text('No Tasks need your attention.'), findsOneWidget);
    },
  );

  testWidgets('attention refresh and error recovery request a fresh snapshot', (
    tester,
  ) async {
    var refreshes = 0;
    Future<void> refresh() async => refreshes += 1;

    await tester.pumpWidget(
      MaterialApp(
        theme: ThemeData(splashFactory: NoSplash.splashFactory),
        home: AttentionHome(
          state: const AttentionLoadError(
            'Current attention could not be loaded.',
          ),
          onRefresh: refresh,
        ),
      ),
    );
    expect(find.text('Couldn’t refresh'), findsOneWidget);
    await tester.tap(find.text('Try again'));
    await tester.pump();
    expect(refreshes, 1);

    await tester.tap(find.byTooltip('Refresh attention'));
    await tester.pump();
    expect(refreshes, 2);
  });
}
