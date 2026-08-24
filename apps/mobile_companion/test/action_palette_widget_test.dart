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
  List<PullRequestMergeMethod>? mergeMethods,
  PullRequestMergeMethod? defaultMergeMethod,
}) => MobilePaletteActionContractAdapter.fromTaskPresentation(
  CompanionTaskActionPresentation(
    id: id,
    label: label,
    keywords: keywords,
    icon: icon,
    requiresConfirmation: requiresConfirmation,
    destructive: destructive,
    mergeMethods: mergeMethods,
    defaultMergeMethod: defaultMergeMethod,
  ),
);

MobilePaletteAction _projectAction(
  CompanionProjectActionId id,
  String label,
  List<String> keywords,
  CompanionActionIcon icon,
) => MobilePaletteActionContractAdapter.fromProjectPresentation(
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
                MobileNativePaletteActions.newTask,
                MobileNativePaletteActions.refreshBoard,
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
    'merge picker confirms an explicit method while destructive actions use the generic confirmation',
    (tester) async {
      final confirmed = <CompanionActionId>[];
      final executed = <MobilePaletteAction>[];
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
                  requiresConfirmation: true,
                  mergeMethods: <PullRequestMergeMethod>[
                    PullRequestMergeMethod.squash,
                    PullRequestMergeMethod.rebase,
                  ],
                  defaultMergeMethod: PullRequestMergeMethod.squash,
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
              onExecute: (action) async => executed.add(action),
            ),
          ),
        ),
      );

      await tester.tap(find.text('Merge Pull Request'));
      await tester.pumpAndSettle();
      expect(find.text('Choose merge method'), findsOneWidget);
      expect(find.text('GitHub default'), findsOneWidget);

      await tester.tap(find.text('Rebase and merge'));
      await tester.pump();
      await tester.tap(find.text('Confirm rebase and merge'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Complete'));
      await tester.pumpAndSettle();

      expect(confirmed, <CompanionActionId>[CompanionActionId.completeTask]);
      expect(executed.single.id, CompanionActionId.mergePullRequest);
      expect(executed.single.selectedMergeMethod, MobileMergeMethod.rebase);
    },
  );
}
