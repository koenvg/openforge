import 'dart:async';

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

  testWidgets(
    'keeps a matching command above the prompt with a phone keyboard',
    (tester) async {
      tester.view.physicalSize = const Size(390, 800);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TaskCreationSheet(
              projectName: 'OpenForge',
              loadPromptCatalog: () async => TaskPromptCatalog(
                provider: 'pi',
                trigger: '/',
                suggestions: <TaskPromptSuggestion>[
                  TaskPromptSuggestion(
                    name: 'review',
                    description: 'Review current changes',
                    kind: TaskPromptSuggestionKind.command,
                    source: 'prompt',
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
      final prompt = find.byType(TextField);
      await tester.enterText(prompt, '/rev');
      await tester.pumpAndSettle();

      final match = find.text('review');
      expect(
        tester.getTopLeft(match).dy,
        lessThan(tester.getTopLeft(prompt).dy),
      );
      expect(tester.getTopLeft(match).dy, greaterThanOrEqualTo(0));
      expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(500));
    },
  );

  testWidgets(
    'scrolls many suggestions above an editable prompt on a small phone',
    (tester) async {
      tester.view.physicalSize = const Size(390, 800);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TaskCreationSheet(
              projectName: 'OpenForge',
              loadPromptCatalog: () async => TaskPromptCatalog(
                provider: 'pi',
                trigger: '/',
                suggestions: List.generate(
                  16,
                  (index) => TaskPromptSuggestion(
                    name: 'command-$index',
                    description: 'Command $index',
                    kind: TaskPromptSuggestionKind.command,
                    source: 'prompt',
                  ),
                ),
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
      final prompt = find.byType(TextField);
      await tester.enterText(prompt, '/');
      await tester.pumpAndSettle();

      expect(
        tester.getTopLeft(find.text('command-0')).dy,
        lessThan(tester.getTopLeft(prompt).dy),
      );
      expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(500));
      await tester.drag(find.byType(ListView), const Offset(0, -1400));
      await tester.pumpAndSettle();
      expect(find.text('command-15'), findsOneWidget);
      expect(
        tester.getBottomLeft(find.text('command-15')).dy,
        lessThanOrEqualTo(500),
      );
      expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(500));
    },
  );

  testWidgets('keeps wrapped skill suggestions tappable at larger text sizes', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 800);
    tester.view.devicePixelRatio = 1;
    tester.view.viewInsets = const FakeViewPadding(bottom: 300);
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    addTearDown(tester.view.resetViewInsets);
    final createdPrompts = <String>[];

    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => MediaQuery(
          data: MediaQuery.of(
            context,
          ).copyWith(textScaler: const TextScaler.linear(2)),
          child: child!,
        ),
        home: Scaffold(
          body: TaskCreationSheet(
            projectName: 'OpenForge',
            loadPromptCatalog: () async => TaskPromptCatalog(
              provider: 'pi',
              trigger: '/',
              suggestions: const <TaskPromptSuggestion>[
                TaskPromptSuggestion(
                  name: 'skill:release-notes',
                  description:
                      'Draft release notes that explain the changes to everyone on the team',
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
    final prompt = find.byType(TextField);
    await tester.enterText(prompt, '/skill');
    await tester.pumpAndSettle();

    final row = find.byType(ListTile);
    final description = find.text(
      'Draft release notes that explain the changes to everyone on the team',
    );
    expect(tester.getSize(row).height, greaterThanOrEqualTo(48));
    expect(
      tester.getBottomLeft(description).dy,
      lessThanOrEqualTo(tester.getBottomLeft(row).dy),
    );
    expect(
      tester.getBottomLeft(row).dy,
      lessThanOrEqualTo(tester.getTopLeft(prompt).dy),
    );
    expect(tester.getTopLeft(row).dy, greaterThanOrEqualTo(0));
    expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(500));
    await tester.tap(find.text('skill:release-notes'));
    await tester.pump();
    expect(
      tester.widget<TextField>(prompt).controller!.text,
      '/skill:release-notes ',
    );
    expect(createdPrompts, isEmpty);

    await tester.enterText(prompt, 'Describe the work');
    await tester.pumpAndSettle();
    expect(find.byType(ListTile), findsNothing);
    expect(
      tester.widget<TextField>(prompt).controller!.text,
      'Describe the work',
    );
  });

  testWidgets(
    'keeps delayed suggestions and the prompt visible as the keyboard opens',
    (tester) async {
      tester.view.physicalSize = const Size(390, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);
      final catalog = Completer<TaskPromptCatalog>();

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: TaskCreationSheet(
              projectName: 'OpenForge',
              loadPromptCatalog: () => catalog.future,
              onCreate: (_) async => const TaskCreateResult(
                taskId: 'T-new',
                projectId: 'P-4',
                boardStatus: 'backlog',
              ),
            ),
          ),
        ),
      );
      final prompt = find.byType(TextField);
      await tester.enterText(prompt, '/rev');
      await tester.pump();
      expect(find.text('review'), findsNothing);

      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      await tester.pump();
      catalog.complete(
        TaskPromptCatalog(
          provider: 'pi',
          trigger: '/',
          suggestions: const <TaskPromptSuggestion>[
            TaskPromptSuggestion(
              name: 'review',
              description: 'Review changes',
              kind: TaskPromptSuggestionKind.command,
              source: 'prompt',
            ),
          ],
        ),
      );
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(find.text('review')).dy,
        greaterThanOrEqualTo(0),
      );
      expect(
        tester.getTopLeft(find.text('review')).dy,
        lessThan(tester.getTopLeft(prompt).dy),
      );
      expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(500));

      tester.view.viewInsets = const FakeViewPadding(bottom: 350);
      await tester.pumpAndSettle();
      expect(
        tester.getTopLeft(find.text('review')).dy,
        greaterThanOrEqualTo(0),
      );
      expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(450));
      await tester.tap(find.text('review'));
      await tester.pump();
      expect(tester.widget<TextField>(prompt).controller!.text, '/review ');
    },
  );

  testWidgets(
    'shows suggestions above the prompt in the keyboard-open modal sheet',
    (tester) async {
      tester.view.physicalSize = const Size(390, 800);
      tester.view.devicePixelRatio = 1;
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      addTearDown(tester.view.resetViewInsets);

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () => showModalBottomSheet<void>(
                  context: context,
                  isScrollControlled: true,
                  useSafeArea: true,
                  showDragHandle: true,
                  builder: (context) => TaskCreationSheet(
                    projectName: 'OpenForge',
                    loadPromptCatalog: () async => TaskPromptCatalog(
                      provider: 'pi',
                      trigger: '/',
                      suggestions: const <TaskPromptSuggestion>[
                        TaskPromptSuggestion(
                          name: 'review',
                          description: 'Review changes',
                          kind: TaskPromptSuggestionKind.command,
                          source: 'prompt',
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
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
      final prompt = find.byType(TextField);
      await tester.enterText(prompt, '/rev');
      await tester.pumpAndSettle();

      expect(
        tester.getTopLeft(find.text('review')).dy,
        greaterThanOrEqualTo(0),
      );
      expect(
        tester.getTopLeft(find.text('review')).dy,
        lessThan(tester.getTopLeft(prompt).dy),
      );
      expect(tester.getBottomLeft(prompt).dy, lessThanOrEqualTo(500));
    },
  );
}
