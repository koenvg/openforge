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
  String agentState = 'running',
  bool agentTerminalAvailable = false,
  String? agentErrorSummary,
}) => TaskDetail(
  taskId: 'KVG-2946',
  title: title,
  projectId: 'P-1',
  projectName: 'OpenForge',
  boardStatus: 'doing',
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

      presentation.setState(const AgentTerminalExited());
      await tester.pump();
      expect(find.byKey(const Key('xterm-surface')), findsOneWidget);
      expect(find.text('Exited'), findsOneWidget);
    },
  );
}

final class _TerminalPresentation extends ChangeNotifier
    implements AgentTerminalPresentation {
  AgentTerminalState _state = const AgentTerminalNoActiveSession();
  bool visible = false;

  @override
  AgentTerminalState get state => _state;

  void setState(AgentTerminalState state) {
    _state = state;
    notifyListeners();
  }

  @override
  void setForeground(bool foreground) {}

  @override
  void setVisible(bool visible) => this.visible = visible;

  @override
  void updateAvailability(bool available) {}
}
