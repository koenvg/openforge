import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette.dart';

void main() {
  testWidgets(
    'task palette filters advertised actions and executes the selected action',
    (tester) async {
      final executed = <CompanionActionId>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MobileActionPalette(
              title: 'Task actions',
              actions: const <MobilePaletteAction>[
                MobilePaletteAction.task(CompanionActionId.startTask),
                MobilePaletteAction.task(CompanionActionId.setAsideTask),
                MobilePaletteAction.task(CompanionActionId.completeTask),
              ],
              onExecute: (action) async => executed.add(action.id),
            ),
          ),
        ),
      );

      expect(find.text('Start Task'), findsOneWidget);
      expect(find.text('Set aside'), findsOneWidget);
      expect(find.text('Complete'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'defer');
      await tester.pump();

      expect(find.text('Start Task'), findsNothing);
      expect(find.text('Set aside'), findsOneWidget);
      expect(find.text('Complete'), findsNothing);

      await tester.tap(find.text('Set aside'));
      await tester.pumpAndSettle();
      expect(executed, <CompanionActionId>[CompanionActionId.setAsideTask]);
    },
  );

  testWidgets(
    'general palette exposes native mobile actions without task search',
    (tester) async {
      final executed = <CompanionActionId>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MobileActionPalette(
              title: 'Actions',
              actions: const <MobilePaletteAction>[
                MobilePaletteAction.general(CompanionActionId.newTask),
                MobilePaletteAction.general(CompanionActionId.refreshBoard),
                MobilePaletteAction.general(CompanionActionId.refreshGithub),
              ],
              onExecute: (action) async => executed.add(action.id),
            ),
          ),
        ),
      );

      expect(find.text('New task'), findsOneWidget);
      expect(find.text('Refresh Board'), findsOneWidget);
      expect(find.text('Refresh GitHub'), findsOneWidget);
      expect(find.textContaining('Search tasks'), findsNothing);

      await tester.tap(find.text('Refresh GitHub'));
      await tester.pumpAndSettle();
      expect(executed, <CompanionActionId>[CompanionActionId.refreshGithub]);
    },
  );

  testWidgets('destructive and merge actions require confirmation', (
    tester,
  ) async {
    final confirmed = <CompanionActionId>[];
    final executed = <CompanionActionId>[];
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: MobileActionPalette(
            title: 'Task actions',
            actions: const <MobilePaletteAction>[
              MobilePaletteAction.task(CompanionActionId.mergePullRequest),
              MobilePaletteAction.task(CompanionActionId.completeTask),
            ],
            onConfirm: (action) async {
              confirmed.add(action.id);
              return action.id == CompanionActionId.mergePullRequest;
            },
            onExecute: (action) async => executed.add(action.id),
          ),
        ),
      ),
    );

    await tester.tap(find.text('Merge Pull Request'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Complete'));
    await tester.pumpAndSettle();

    expect(confirmed, <CompanionActionId>[
      CompanionActionId.mergePullRequest,
      CompanionActionId.completeTask,
    ]);
    expect(executed, <CompanionActionId>[CompanionActionId.mergePullRequest]);
  });
}
