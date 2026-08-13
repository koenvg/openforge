import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

MobilePaletteAction _taskAction(
  CompanionTaskActionId id,
  String label,
  List<String> keywords,
  CompanionActionIcon icon, {
  bool requiresConfirmation = false,
  bool destructive = false,
}) => MobilePaletteAction.task(
  CompanionTaskActionPresentation(
    id: id,
    label: label,
    keywords: keywords,
    icon: icon,
    requiresConfirmation: requiresConfirmation,
    destructive: destructive,
  ),
);

MobilePaletteAction _projectAction(
  CompanionProjectActionId id,
  String label,
  List<String> keywords,
  CompanionActionIcon icon,
) => MobilePaletteAction.project(
  CompanionProjectActionPresentation(
    id: id,
    label: label,
    keywords: keywords,
    icon: icon,
    requiresConfirmation: false,
    destructive: false,
  ),
);

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
              actions: <MobilePaletteAction>[
                _taskAction(
                  CompanionTaskActionId.startTask,
                  'Start Task',
                  <String>['run'],
                  CompanionActionIcon.play,
                ),
                _taskAction(
                  CompanionTaskActionId.setAsideTask,
                  'Set aside',
                  <String>['defer'],
                  CompanionActionIcon.visibilityOff,
                ),
                _taskAction(
                  CompanionTaskActionId.completeTask,
                  'Complete',
                  <String>['finish'],
                  CompanionActionIcon.complete,
                  requiresConfirmation: true,
                  destructive: true,
                ),
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
              actions: <MobilePaletteAction>[
                MobilePaletteAction.newTask,
                MobilePaletteAction.refreshBoard,
                _projectAction(
                  CompanionProjectActionId.refreshGithub,
                  'Refresh GitHub',
                  <String>['github'],
                  CompanionActionIcon.refresh,
                ),
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

  testWidgets(
    'merge executes immediately while destructive actions require confirmation',
    (tester) async {
      final confirmed = <CompanionActionId>[];
      final executed = <CompanionActionId>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: MobileActionPalette(
              title: 'Task actions',
              actions: <MobilePaletteAction>[
                _taskAction(
                  CompanionTaskActionId.mergePullRequest,
                  'Merge Pull Request',
                  <String>['merge'],
                  CompanionActionIcon.merge,
                ),
                _taskAction(
                  CompanionTaskActionId.completeTask,
                  'Complete',
                  <String>['finish'],
                  CompanionActionIcon.complete,
                  requiresConfirmation: true,
                  destructive: true,
                ),
              ],
              onConfirm: (action) async {
                confirmed.add(action.id);
                return false;
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

      expect(confirmed, <CompanionActionId>[CompanionActionId.completeTask]);
      expect(executed, <CompanionActionId>[CompanionActionId.mergePullRequest]);
    },
  );
}
