import 'package:flutter/material.dart';
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
  createdAt: DateTime.utc(2026, 7, 30, 10),
  updatedAt: DateTime.utc(2026, 7, 30, 11),
  agentUpdatedAt: DateTime.utc(2026, 7, 30, 12),
);

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
    expect(
      find.bySemanticsLabel('Handoff Notes. Ready for review.'),
      findsOneWidget,
    );
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
      expect(
        find.bySemanticsLabel('Handoff Notes. No Handoff Notes yet.'),
        findsOneWidget,
      );
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

      presentation.setState(const AgentTerminalReady());
      await tester.pump();
      expect(find.byKey(const Key('xterm-surface')), findsOneWidget);

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
}

final class _TerminalPresentation extends ChangeNotifier
    implements AgentTerminalPresentation {
  AgentTerminalState _state = const AgentTerminalNoActiveSession();
  bool visible = false;
  bool foreground = true;
  var closeCalls = 0;
  @override
  AgentTerminalState get state => _state;

  void setState(AgentTerminalState state) {
    _state = state;
    notifyListeners();
  }

  @override
  Future<void> closeForTaskCompletion() async => closeCalls += 1;

  @override
  void setForeground(bool foreground) => this.foreground = foreground;

  @override
  void setVisible(bool visible) => this.visible = visible;

  @override
  void updateAvailability(bool available) {}
}
