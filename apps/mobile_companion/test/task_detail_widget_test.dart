import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/attention/attention_home.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/terminal/agent_terminal_controller.dart';
import 'package:openforge_companion/src/terminal/agent_terminal_surface.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_screen.dart';

TaskDetail _detail({
  String title = 'Mobile Task detail',
  String? handoffNotes = 'Ready for review.',
  String boardStatus = 'doing',
  String agentState = 'running',
  bool agentTerminalAvailable = false,
  String? agentErrorSummary,
  List<String> labels = const <String>[],
  List<TaskRelationship> dependencies = const <TaskRelationship>[],
  List<DependentTask> dependentTasks = const <DependentTask>[],
}) => TaskDetail(
  taskId: 'KVG-2946',
  title: title,
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: boardStatus,
  handoffNotes: handoffNotes,
  agentState: agentState,
  agentTerminalAvailable: agentTerminalAvailable,
  agentErrorSummary: agentErrorSummary,
  labels: labels,
  dependencies: dependencies,
  dependentTasks: dependentTasks,
  createdAt: DateTime.utc(2026, 7, 30, 10),
  updatedAt: DateTime.utc(2026, 7, 30, 11),
  agentUpdatedAt: DateTime.utc(2026, 7, 30, 12),
);

Offset _textOffsetToPosition(RenderParagraph paragraph, int offset) {
  const caret = Rect.fromLTWH(0, 0, 2, 20);
  final localOffset = paragraph.getOffsetForCaret(
    TextPosition(offset: offset),
    caret,
  );
  return paragraph.localToGlobal(localOffset);
}

void main() {
  testWidgets('Task detail shows the approved fields with accessible semantics', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: TaskDetailView(
          state: TaskDetailLoaded(
            _detail(
              agentState: 'failed',
              agentErrorSummary: 'Agent failed. Review details on the desktop.',
            ),
          ),
          onRefresh: () async {},
        ),
      ),
    );

    expect(find.text('Mobile Task detail'), findsOneWidget);
    expect(find.text('OpenForge'), findsOneWidget);
    expect(find.text('Doing'), findsOneWidget);
    expect(find.text('Ready for review.'), findsOneWidget);
    expect(find.text('Failed'), findsOneWidget);
    expect(
      find.text('Agent failed. Review details on the desktop.'),
      findsOneWidget,
    );
    expect(find.text('Created'), findsOneWidget);
    expect(find.text('Task updated'), findsOneWidget);
    expect(find.text('Agent updated'), findsOneWidget);
    expect(
      find.bySemanticsLabel(
        'Task Mobile Task detail. Project OpenForge. Board Status Doing. Agent Failed.',
      ),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Handoff Notes'), findsOneWidget);
    expect(find.bySemanticsLabel('Ready for review.'), findsOneWidget);
    expect(find.text('Labels'), findsNothing);
    expect(find.text('Dependencies'), findsNothing);
    expect(find.text('Dependent tasks'), findsNothing);
  });

  testWidgets(
    'Task detail shows labels and related Tasks and opens either relationship',
    (tester) async {
      final openedTaskIds = <String>[];
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(
              _detail(
                labels: const <String>['mobile', 'review'],
                dependencies: const <TaskRelationship>[
                  TaskRelationship(
                    taskId: 'KVG-2944',
                    title: 'Prepare companion contract',
                    boardStatus: 'done',
                  ),
                  TaskRelationship(
                    taskId: 'KVG-2945',
                    title: 'Approve release notes',
                    boardStatus: 'backlog',
                  ),
                ],
                dependentTasks: const <DependentTask>[
                  DependentTask(
                    taskId: 'KVG-2947',
                    title: 'Ship companion release',
                    boardStatus: 'backlog',
                    remainingDependencyCount: 1,
                  ),
                ],
              ),
            ),
            onRefresh: () async {},
            onOpenTask: openedTaskIds.add,
          ),
        ),
      );

      expect(find.text('Labels'), findsOneWidget);
      expect(find.text('mobile'), findsOneWidget);
      expect(find.text('review'), findsOneWidget);
      expect(find.text('Dependencies'), findsOneWidget);
      expect(find.text('Prepare companion contract'), findsOneWidget);
      expect(find.text('Approve release notes'), findsOneWidget);
      expect(find.text('Waiting on 1 dependency'), findsOneWidget);
      expect(find.bySemanticsLabel('Labels. mobile, review.'), findsOneWidget);
      await tester.tap(find.text('Prepare companion contract'));

      await tester.scrollUntilVisible(find.text('Dependent tasks'), 200);
      expect(find.text('Dependent tasks'), findsOneWidget);
      expect(find.text('Ship companion release'), findsOneWidget);
      expect(
        find.textContaining('Still waits on 1 dependency'),
        findsOneWidget,
      );
      await tester.tap(find.text('Ship companion release'));

      expect(openedTaskIds, <String>['KVG-2944', 'KVG-2947']);
    },
  );

  testWidgets('Handoff Notes render with Markdown formatting', (tester) async {
    const markdown = '''
## Summary

**Ready** for review.

- Preserves lists
- Supports `inline code`

Read the [**important** mobile guide](https://docs.openforge.dev/mobile).
[![Linked diagram](https://tracker.example/linked.png)](https://docs.openforge.dev/diagram)
![Remote diagram](https://tracker.example/pixel.png)
![Local diagram](file:///tmp/private.png)
![Embedded diagram](data:image/png;base64,aGVsbG8=)
![Bundled diagram](resource:assets/private.png)
''';

    await tester.pumpWidget(
      MaterialApp(
        home: TaskDetailView(
          state: TaskDetailLoaded(_detail(handoffNotes: markdown)),
          onRefresh: () async {},
        ),
      ),
    );

    expect(find.text('Summary'), findsOneWidget);
    expect(find.text('Ready for review.', findRichText: true), findsOneWidget);
    expect(find.text('Preserves lists', findRichText: true), findsOneWidget);
    expect(
      find.text('Supports inline code', findRichText: true),
      findsOneWidget,
    );
    final visibleLink = find.byWidgetPredicate((widget) {
      if (widget is! Text) return false;
      final plainText = widget.data ?? widget.textSpan?.toPlainText();
      return plainText?.contains(
            'important mobile guide (https://docs.openforge.dev/mobile)',
          ) ??
          false;
    });
    expect(visibleLink, findsOneWidget);
    expect(
      tester
          .getSemantics(visibleLink)
          .getSemanticsData()
          .hasAction(SemanticsAction.tap),
      isFalse,
    );
    expect(find.text('[Image: Linked diagram]'), findsOneWidget);
    expect(find.text('[Image: Remote diagram]'), findsOneWidget);
    expect(find.text('[Image: Local diagram]'), findsOneWidget);
    expect(find.text('[Image: Embedded diagram]'), findsOneWidget);
    expect(find.text('[Image: Bundled diagram]'), findsOneWidget);
    expect(find.bySemanticsLabel('Handoff Notes'), findsOneWidget);
    expect(
      find.bySemanticsLabel(RegExp(r'^Summary\s+Ready for review\.')),
      findsOneWidget,
    );
    expect(
      find.bySemanticsLabel(
        RegExp(r'tracker\.example|file:///|data:image|resource:'),
      ),
      findsNothing,
    );
    final firstParagraph = tester.renderObject<RenderParagraph>(
      find.text('Ready for review.', findRichText: true),
    );
    final lastParagraph = tester.renderObject<RenderParagraph>(
      find.text('Supports inline code', findRichText: true),
    );
    final selectionGesture = await tester.startGesture(
      _textOffsetToPosition(firstParagraph, 0),
      kind: PointerDeviceKind.mouse,
    );
    addTearDown(selectionGesture.removePointer);
    await tester.pump();
    await selectionGesture.moveTo(
      _textOffsetToPosition(lastParagraph, 'Supports inline code'.length),
    );
    await selectionGesture.up();
    await tester.pump();

    expect(
      firstParagraph.selections.any((selection) => !selection.isCollapsed),
      isTrue,
    );
    expect(
      lastParagraph.selections.any((selection) => !selection.isCollapsed),
      isTrue,
    );
    expect(find.byType(Image), findsNothing);
    expect(find.byType(SelectionArea), findsOneWidget);
    expect(find.byType(SelectableText), findsNothing);
    expect(find.text(markdown.trim()), findsNothing);
  });

  testWidgets(
    'Task detail accepts prompt-derived title and calmly shows no Handoff Notes',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(
              _detail(
                title: 'Prompt-derived fallback title',
                handoffNotes: null,
                agentState: 'blocked',
              ),
            ),
            onRefresh: () async {},
          ),
        ),
      );

      expect(find.text('Prompt-derived fallback title'), findsOneWidget);
      expect(find.text('No Handoff Notes yet.'), findsOneWidget);
      expect(find.text('Needs input'), findsOneWidget);
      expect(find.bySemanticsLabel('Handoff Notes'), findsOneWidget);
      expect(find.bySemanticsLabel('No Handoff Notes yet.'), findsOneWidget);
    },
  );

  testWidgets(
    'Complete is offered for doing Task detail but never backlog detail',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail()),
            onRefresh: () async {},
            onComplete: () async => TaskCompleteAttempt.completed,
          ),
        ),
      );
      expect(find.widgetWithText(FilledButton, 'Complete'), findsOneWidget);

      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(boardStatus: 'backlog')),
            onRefresh: () async {},
            onComplete: () async => TaskCompleteAttempt.completed,
          ),
        ),
      );
      expect(find.widgetWithText(FilledButton, 'Complete'), findsNothing);
    },
  );

  testWidgets(
    'Complete confirmation names the Task and warns for a running Agent',
    (tester) async {
      var completeCalls = 0;
      var completedCallbacks = 0;
      final presentation = _TerminalPresentation();
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(agentState: 'running')),
            onRefresh: () async {},
            onComplete: () async {
              completeCalls += 1;
              return TaskCompleteAttempt.completed;
            },
            onCompleted: () async => completedCallbacks += 1,
            terminalSurface: AgentTerminalSurface(
              presentation: presentation,
              terminal: const SizedBox(),
              dispose: () {},
            ),
          ),
        ),
      );

      await tester.tap(find.widgetWithText(FilledButton, 'Complete'));
      await tester.pumpAndSettle();

      expect(find.textContaining('Mobile Task detail'), findsWidgets);
      expect(find.textContaining('worktree will be removed'), findsOneWidget);
      expect(find.textContaining('OpenForge-owned branch'), findsOneWidget);
      expect(find.textContaining('uncommitted work'), findsOneWidget);
      expect(
        find.textContaining('running Agent and all Task shells will stop'),
        findsOneWidget,
      );

      await tester.tap(find.widgetWithText(TextButton, 'Cancel'));
      await tester.pumpAndSettle();
      expect(completeCalls, 0);
      expect(presentation.closeCalls, 0);

      await tester.tap(find.widgetWithText(FilledButton, 'Complete'));
      await tester.pumpAndSettle();
      await tester.tap(
        find.descendant(
          of: find.byType(AlertDialog),
          matching: find.widgetWithText(FilledButton, 'Complete'),
        ),
      );
      await tester.pumpAndSettle();

      expect(completeCalls, 1);
      expect(completedCallbacks, 1);
      expect(presentation.closeCalls, 1);
    },
  );

  testWidgets('pending Complete is disabled and failure is announced safely', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        home: TaskDetailView(
          state: TaskDetailLoaded(_detail()),
          onRefresh: () async {},
          onComplete: () async => TaskCompleteAttempt.failed,
          completePending: true,
          completeError:
              'OpenForge could not confirm whether Complete succeeded. Current Task state was refreshed.',
        ),
      ),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
    expect(find.text('Completing…'), findsOneWidget);
    expect(
      find.bySemanticsLabel(
        'OpenForge could not confirm whether Complete succeeded. Current Task state was refreshed.',
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'Backlog detail starts immediately and announces a disabled pending state',
    (tester) async {
      var starts = 0;
      Future<void> start() async => starts += 1;

      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(boardStatus: 'backlog')),
            startAction: const TaskStartIdle(),
            onStart: start,
            onRefresh: () async {},
          ),
        ),
      );

      expect(find.text('Start'), findsOneWidget);
      await tester.tap(find.text('Start'));
      await tester.pump();
      expect(starts, 1);

      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(boardStatus: 'backlog')),
            startAction: const TaskStartPending(),
            onStart: start,
            onRefresh: () async {},
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Starting…'), findsOneWidget);
      expect(find.bySemanticsLabel('Starting Task'), findsOneWidget);
      expect(
        tester.widget<FilledButton>(find.byType(FilledButton)).onPressed,
        isNull,
      );
      await tester.tap(find.text('Starting…'));
      expect(starts, 1);

      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail()),
            startAction: const TaskStartIdle(),
            onStart: start,
            onRefresh: () async {},
          ),
        ),
      );
      expect(find.text('Start'), findsNothing);
    },
  );

  testWidgets(
    'desktop-action-required is clear without exposing backend detail',
    (tester) async {
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(boardStatus: 'backlog')),
            startAction: const TaskStartDesktopActionRequired(),
            onStart: () async {},
            onRefresh: () async {},
          ),
        ),
      );

      expect(
        find.textContaining('Open this Task on the desktop'),
        findsOneWidget,
      );
      expect(find.bySemanticsLabel('Desktop action required'), findsOneWidget);
      expect(find.textContaining('workspace detail'), findsNothing);
    },
  );

  testWidgets('missing Task has a calm explicit state', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        home: TaskDetailView(
          state: const TaskDetailNotFound(),
          onRefresh: () async {},
        ),
      ),
    );

    expect(find.text('Task no longer available'), findsOneWidget);
    expect(
      find.text('This Task may have been Completed or deleted on the desktop.'),
      findsOneWidget,
    );
    expect(find.bySemanticsLabel('Task no longer available'), findsOneWidget);
  });

  testWidgets(
    'returning from Task detail preserves the attention scroll position',
    (tester) async {
      final items = List<AttentionItem>.generate(
        24,
        (index) => AttentionItem(
          taskId: 'T-$index',
          projectId: 'P-1',
          projectName: 'OpenForge',
          title: 'Task $index',
          state: 'needs-input',
          reason: 'Agent needs your input to continue.',
          activityAt: DateTime.utc(2026, 7, 30, 12, index),
        ),
      );

      await tester.pumpWidget(
        MaterialApp(
          home: Builder(
            builder: (context) => AttentionHome(
              state: AttentionLoaded(
                AttentionSnapshot(
                  snapshotAt: DateTime.utc(2026, 7, 30, 13),
                  items: items,
                ),
              ),
              onRefresh: () async {},
              onTaskSelected: (taskId) {
                Navigator.of(context).push<void>(
                  MaterialPageRoute<void>(
                    builder: (_) => TaskDetailView(
                      state: TaskDetailLoaded(
                        _detail(title: 'Selected $taskId'),
                      ),
                      onRefresh: () async {},
                    ),
                  ),
                );
              },
            ),
          ),
        ),
      );

      await tester.scrollUntilVisible(find.text('Task 18'), 400);
      final row = find.bySemanticsLabel(RegExp(r'^Task Task 18,'));
      await tester.ensureVisible(row);
      await tester.pump();
      final scrollable = tester.state<ScrollableState>(find.byType(Scrollable));
      final before = scrollable.position.pixels;
      await tester.tap(row);
      await tester.pumpAndSettle();
      expect(find.text('Selected T-18'), findsOneWidget);

      await tester.pageBack();
      await tester.pumpAndSettle();

      final after = tester
          .state<ScrollableState>(find.byType(Scrollable))
          .position
          .pixels;
      expect(after, before);
      expect(find.text('Task 18'), findsOneWidget);
    },
  );

  testWidgets(
    'Details is initial and Terminal exposes distinct attachment states',
    (tester) async {
      final presentation = _TerminalPresentation();
      final surface = AgentTerminalSurface(
        presentation: presentation,
        terminal: const ColoredBox(
          key: Key('xterm-surface'),
          color: Colors.black,
        ),
        dispose: () {},
      );
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(agentTerminalAvailable: true)),
            onRefresh: () async {},
            terminalSurface: surface,
          ),
        ),
      );
      await tester.pump();

      expect(find.text('Details'), findsOneWidget);
      expect(find.text('Terminal'), findsOneWidget);
      expect(find.text('Mobile Task detail'), findsOneWidget);
      expect(presentation.visible, isFalse);

      await tester.tap(find.text('Terminal'));
      await tester.pumpAndSettle();
      expect(presentation.visible, isTrue);
      expect(find.text('No active Agent terminal'), findsOneWidget);

      presentation.setState(const AgentTerminalAttaching());
      await tester.pump();
      expect(find.text('Attaching to Agent terminal'), findsOneWidget);
      expect(find.byKey(const Key('xterm-surface')), findsOneWidget);

      presentation.setState(const AgentTerminalReady());
      await tester.pump();
      expect(find.byKey(const Key('xterm-surface')), findsOneWidget);

      presentation.setState(const AgentTerminalReconnecting());
      await tester.pump();
      expect(find.text('Reconnecting Agent terminal'), findsOneWidget);
      expect(find.byKey(const Key('xterm-surface')), findsOneWidget);

      presentation.setState(
        const AgentTerminalReconnecting(retryAvailable: true),
      );
      await tester.pump();
      expect(find.text('Connection interrupted'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Retry now'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Retry now'));
      expect(presentation.retryCalls, 1);
      presentation.setState(const AgentTerminalReady());
      await tester.pump();

      await tester.tap(find.text('Details'));
      await tester.pumpAndSettle();
      expect(presentation.visible, isFalse);
      expect(
        find.byKey(const Key('xterm-surface'), skipOffstage: false),
        findsOneWidget,
      );

      await tester.tap(find.text('Terminal'));
      await tester.pumpAndSettle();
      expect(presentation.visible, isTrue);

      presentation.setState(const AgentTerminalExited());
      await tester.pump();
      expect(find.byKey(const Key('xterm-surface')), findsOneWidget);
      expect(find.text('Exited'), findsOneWidget);
    },
  );

  testWidgets(
    'Task terminal follows foreground lifecycle without opening from Details',
    (tester) async {
      addTearDown(() {
        tester.binding.handleAppLifecycleStateChanged(
          AppLifecycleState.resumed,
        );
      });
      final presentation = _TerminalPresentation();
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail(agentTerminalAvailable: true)),
            onRefresh: () async {},
            terminalSurface: AgentTerminalSurface(
              presentation: presentation,
              terminal: const SizedBox(),
              dispose: () {},
            ),
          ),
        ),
      );
      await tester.pump();
      expect(presentation.visible, isFalse);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(presentation.foreground, isFalse);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(presentation.foreground, isTrue);
      expect(presentation.visible, isFalse);

      await tester.tap(find.text('Terminal'));
      await tester.pumpAndSettle();
      expect(presentation.visible, isTrue);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      await tester.pump();
      expect(presentation.foreground, isFalse);
    },
  );

  testWidgets(
    'Delete is detail-only for Backlog and cancellation sends no request',
    (tester) async {
      var calls = 0;
      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(
              _detail(title: 'Backlog cleanup', boardStatus: 'backlog'),
            ),
            onRefresh: () async {},
            onDelete: () async {
              calls += 1;
              return TaskDeleteResult.succeeded;
            },
          ),
        ),
      );

      await tester.drag(find.byType(ListView), const Offset(0, -600));
      await tester.pumpAndSettle();
      expect(
        find.widgetWithText(OutlinedButton, 'Delete Task'),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(OutlinedButton, 'Delete Task'));
      await tester.pumpAndSettle();
      expect(find.text('Delete “Backlog cleanup”?'), findsOneWidget);
      await tester.tap(find.text('Cancel'));
      await tester.pumpAndSettle();
      expect(calls, 0);

      await tester.pumpWidget(
        MaterialApp(
          home: TaskDetailView(
            state: TaskDetailLoaded(_detail()),
            onRefresh: () async {},
            onDelete: () async => TaskDeleteResult.succeeded,
          ),
        ),
      );
      expect(find.widgetWithText(OutlinedButton, 'Delete Task'), findsNothing);
    },
  );

  testWidgets('confirmed Delete is disabled and announced while pending', (
    tester,
  ) async {
    final pending = Completer<TaskDeleteResult>();
    var successCallbacks = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: TaskDetailView(
          state: TaskDetailLoaded(
            _detail(title: 'Backlog cleanup', boardStatus: 'backlog'),
          ),
          onRefresh: () async {},
          onDelete: () => pending.future,
          onDeleteSucceeded: () async => successCallbacks += 1,
        ),
      ),
    );

    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Delete Task'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pump();

    expect(find.text('Deleting…'), findsOneWidget);
    expect(
      find.bySemanticsLabel('Deleting Task Backlog cleanup'),
      findsOneWidget,
    );
    final button = tester.widget<OutlinedButton>(
      find.widgetWithText(OutlinedButton, 'Deleting…'),
    );
    expect(button.onPressed, isNull);

    pending.complete(TaskDeleteResult.succeeded);
    await tester.pumpAndSettle();
    expect(successCallbacks, 1);
  });
}

final class _TerminalPresentation extends ChangeNotifier
    implements AgentTerminalPresentation {
  AgentTerminalState _state = const AgentTerminalNoActiveSession();
  bool visible = false;
  bool foreground = true;
  var closeCalls = 0;
  var retryCalls = 0;
  @override
  AgentTerminalState get state => _state;

  void setState(AgentTerminalState state) {
    _state = state;
    notifyListeners();
  }

  @override
  Future<void> closeForTaskCompletion() async => closeCalls += 1;

  @override
  void retryNow() => retryCalls += 1;
  @override
  void setForeground(bool foreground) => this.foreground = foreground;

  @override
  void setVisible(bool visible) => this.visible = visible;

  @override
  void updateAvailability(bool available) {}
}
