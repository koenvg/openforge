import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/project_board/project_board_task_card.dart';

void main() {
  for (final lane in <ProjectBoardLane>[
    ProjectBoardLane.focus,
    ProjectBoardLane.outOfFocus,
  ]) {
    testWidgets(
      'unread output is visible and accessible in ${lane.wireValue}',
      (tester) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ProjectBoardTaskCard(
                task: _task(lane, true),
                onTap: () {},
                onActions: null,
              ),
            ),
          ),
        );
        expect(find.text('Unread agent output'), findsOneWidget);
        expect(find.text('Waiting for review'), findsOneWidget);
        expect(find.text('Paused'), findsOneWidget);
        expect(
          find.bySemanticsLabel(RegExp('Unread agent output')),
          findsOneWidget,
        );

        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: ProjectBoardTaskCard(
                task: _task(lane, false),
                onTap: () {},
                onActions: null,
              ),
            ),
          ),
        );
        expect(find.text('Unread agent output'), findsNothing);
        expect(
          find.bySemanticsLabel(RegExp('Unread agent output')),
          findsNothing,
        );
        expect(find.text('Waiting for review'), findsOneWidget);
      },
    );
  }
}

ProjectBoardTask _task(ProjectBoardLane lane, bool unread) => ProjectBoardTask(
  taskId: 'T-1',
  title: 'Review result',
  lane: lane,
  state: 'paused',
  reason: 'Waiting for review',
  activityAt: DateTime.utc(2026),
  dependencyCount: 0,
  waitingDependencyCount: 0,
  labels: const <String>[],
  pullRequestCount: 0,
  primaryPullRequestNumber: null,
  hasUnreadAgentOutput: unread,
);
