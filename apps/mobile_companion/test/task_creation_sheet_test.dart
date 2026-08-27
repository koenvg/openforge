import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/project_board/task_creation_sheet.dart';

void main() {
  testWidgets(
    'filters and inserts desktop Task prompt suggestions from the provider trigger',
    (tester) async {
      final createdPrompts = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TaskCreationSheet(
              projectName: 'OpenForge',
              loadPromptCatalog: () async => TaskPromptCatalog(
                provider: 'pi',
                trigger: '/',
                suggestions: const <TaskPromptSuggestion>[
                  TaskPromptSuggestion(
                    name: 'review',
                    description: 'Review current changes',
                    kind: TaskPromptSuggestionKind.command,
                    source: 'prompt',
                  ),
                  TaskPromptSuggestion(
                    name: 'skill:release-notes',
                    description: 'Draft release notes',
                    kind: TaskPromptSuggestionKind.skill,
                    source: 'skill',
                  ),
                ],
              ),
              onCreate: (prompt) async {
                createdPrompts.add(prompt);
                return const TaskCreateResult(
                  taskId: 'T-new',
                  projectId: 'P-4',
                  boardStatus: 'backlog',
                );
              },
            ),
          ),
        ),
      );

      final promptField = find.byType(TextField);
      await tester.enterText(promptField, '/rev');
      await tester.pumpAndSettle();

      expect(find.text('review'), findsOneWidget);
      expect(find.text('skill:release-notes'), findsNothing);
      expect(find.text('Review current changes'), findsOneWidget);
      expect(find.text('prompt'), findsOneWidget);

      await tester.tap(find.text('review'));
      await tester.pump();

      expect(
        tester.widget<TextField>(promptField).controller!.text,
        '/review ',
      );
      expect(createdPrompts, isEmpty);
    },
  );

  testWidgets('uses the desktop dollar trigger for Codex skills', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: TaskCreationSheet(
            projectName: 'OpenForge',
            loadPromptCatalog: () async => TaskPromptCatalog(
              provider: 'codex',
              trigger: r'$',
              suggestions: const <TaskPromptSuggestion>[
                TaskPromptSuggestion(
                  name: 'skill:review',
                  description: 'Review changes',
                  kind: TaskPromptSuggestionKind.skill,
                  source: 'skill',
                ),
              ],
            ),
            onCreate: (_) async => const TaskCreateResult(
              taskId: 'T-new',
              projectId: 'P-4',
              boardStatus: 'backlog',
            ),
          ),
        ),
      ),
    );

    final promptField = find.byType(TextField);
    await tester.enterText(promptField, '/skill');
    await tester.pumpAndSettle();
    expect(find.text('skill:review'), findsNothing);

    await tester.enterText(promptField, r'$skill');
    await tester.pumpAndSettle();
    expect(find.text('skill:review'), findsOneWidget);
    await tester.tap(find.text('skill:review'));
    await tester.pump();

    expect(
      tester.widget<TextField>(promptField).controller!.text,
      r'$skill:review ',
    );
  });
}
