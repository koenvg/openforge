import 'dart:io';
import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette_controller.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/project_board/project_board_controller.dart';
import 'package:openforge_companion/src/project_board/project_board_home.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

const _longTaskTitle =
    '123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890';

final class _WidgetClient
    implements
        CompanionClient,
        CompanionTaskActionClient,
        CompanionActionPaletteClient {
  final List<(String, String)> creationRequests = <(String, String)>[];
  final List<String> promptCatalogRequests = <String>[];
  final List<String> actionRequests = <String>[];
  Object? creationError;
  Object? githubRefreshError;
  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) async => ProjectCatalog(
    snapshotAt: DateTime.utc(2026, 8, 1),
    projects: const <ProjectCatalogItem>[
      ProjectCatalogItem(projectId: 'P-1', name: 'Alpha'),
      ProjectCatalogItem(projectId: 'P-2', name: 'Beta'),
    ],
  );

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async => _board(projectId, projectId == 'P-1' ? 'Alpha' : 'Beta');

  @override
  Future<TaskPromptCatalog> fetchTaskPromptCatalog(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async {
    promptCatalogRequests.add(projectId);
    return TaskPromptCatalog(
      provider: 'pi',
      trigger: '/',
      suggestions: const <TaskPromptSuggestion>[
        TaskPromptSuggestion(
          name: 'skill:release-notes',
          description: 'Draft release notes',
          kind: TaskPromptSuggestionKind.skill,
          source: 'skill',
        ),
      ],
    );
  }

  @override
  Future<TaskCreateResult> createTask(
    CompanionTrustRecord trustRecord,
    String projectId,
    String initialPrompt,
  ) async {
    creationRequests.add((projectId, initialPrompt));
    if (creationError case final Object error) throw error;
    return TaskCreateResult(
      taskId: 'T-new',
      projectId: projectId,
      boardStatus: 'backlog',
    );
  }

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => TaskDetail(
    taskId: taskId,
    initialPrompt: 'Start this Backlog Task.',
    title: 'Backlog Task',
    projectId: 'P-1',
    projectName: 'Alpha',
    boardStatus: 'backlog',
    agentState: 'waiting',
    agentErrorSummary: null,
    createdAt: DateTime.utc(2026, 8, 1, 10),
    updatedAt: DateTime.utc(2026, 8, 1, 11),
    agentUpdatedAt: null,
  );

  @override
  Future<ProjectActionsSnapshot> fetchProjectActions(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async => ProjectActionsSnapshot(
    projectId: projectId,
    actions: <CompanionProjectActionPresentation>[
      CompanionProjectActionPresentation(
        id: CompanionProjectActionId.refreshGithub,
        label: 'Refresh GitHub',
        keywords: <String>['github'],
        icon: CompanionActionIcon.refresh,
        requiresConfirmation: false,
        destructive: false,
      ),
    ],
  );

  @override
  Future<TaskActionsSnapshot> fetchTaskActions(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => TaskActionsSnapshot(
    taskId: taskId,
    actions: taskId == 'T-backlog'
        ? <CompanionTaskActionPresentation>[
            CompanionTaskActionPresentation(
              id: CompanionTaskActionId.deleteTask,
              label: 'Delete',
              keywords: <String>['delete'],
              icon: CompanionActionIcon.delete,
              requiresConfirmation: true,
              destructive: true,
            ),
          ]
        : <CompanionTaskActionPresentation>[
            CompanionTaskActionPresentation(
              id: CompanionTaskActionId.setAsideTask,
              label: 'Set aside',
              keywords: <String>['defer'],
              icon: CompanionActionIcon.visibilityOff,
              requiresConfirmation: false,
              destructive: false,
            ),
            CompanionTaskActionPresentation(
              id: CompanionTaskActionId.completeTask,
              label: 'Complete',
              keywords: <String>['finish'],
              icon: CompanionActionIcon.complete,
              requiresConfirmation: true,
              destructive: true,
            ),
          ],
  );

  @override
  Future<void> setAsideTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => actionRequests.add('set-aside:$taskId');

  @override
  Future<void> refreshGithub(CompanionTrustRecord trustRecord) async {
    actionRequests.add('refresh-github');
    if (githubRefreshError case final Object error) throw error;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'Unexpected client call: ${invocation.memberName}',
  );
}

final class _WidgetStorage implements CompanionProjectStorage {
  final record = CompanionTrustRecord(
    hostId: 'host-1',
    certificateSha256: 'AA:BB',
    endpointCandidates: <Uri>[Uri.parse('https://openforge.local')],
    deviceId: 'device-1',
    deviceCredential: 'credential',
  );
  String? selected;

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<String?> loadSelectedProject(String hostId) async => selected;

  @override
  Future<void> saveSelectedProject(String hostId, String projectId) async {
    selected = projectId;
  }

  @override
  Future<void> clearSelectedProject(String hostId) async => selected = null;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'Unexpected storage call: ${invocation.memberName}',
  );
}

void main() {
  testWidgets('shows the Selected Project and canonical tabs with counts', (
    tester,
  ) async {
    final controller = ProjectBoardController(
      client: _WidgetClient(),
      storage: _WidgetStorage(),
    );
    await controller.refresh();

    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    expect(find.text('Alpha'), findsOneWidget);
    expect(find.text('Focus 1'), findsOneWidget);
    expect(find.text('In Flight 1'), findsOneWidget);
    expect(find.text('Out of Focus 1'), findsOneWidget);
    expect(find.text('Backlog 1'), findsOneWidget);
    final selector = find.bySemanticsLabel(RegExp(r'Selected Project, Alpha'));
    expect(selector, findsOneWidget);
    expect(
      tester
          .getSemantics(selector)
          .getSemanticsData()
          .hasAction(SemanticsAction.tap),
      isTrue,
    );
  });

  testWidgets('uses pull-to-refresh without a redundant app-bar action', (
    tester,
  ) async {
    final controller = ProjectBoardController(
      client: _WidgetClient(),
      storage: _WidgetStorage(),
    );
    await controller.refresh();

    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    expect(find.byType(RefreshIndicator), findsOneWidget);
    expect(find.byTooltip('Refresh Mobile Project Board'), findsNothing);
  });

  testWidgets('creates a Task from the selected Project Board', (tester) async {
    final client = _WidgetClient();
    final selectedTasks = <String>[];
    final controller = ProjectBoardController(
      client: client,
      storage: _WidgetStorage(),
    );
    await controller.refresh();

    await tester.pumpWidget(
      MaterialApp(
        home: ProjectBoardHome(
          controller: controller,
          onTaskSelected: selectedTasks.add,
        ),
      ),
    );

    await tester.tap(find.bySemanticsLabel('Create new Task'));
    await tester.pumpAndSettle();
    expect(find.text('Create Task'), findsWidgets);
    expect(find.text('Project'), findsOneWidget);
    expect(
      find.text(
        'Creates a Task in Backlog using desktop-saved Project defaults.',
      ),
      findsOneWidget,
    );
    expect(find.text('What needs to be done?'), findsOneWidget);
    await tester.enterText(
      find.byType(TextField),
      'Investigate mobile creation',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create Task'));
    await tester.pumpAndSettle();

    expect(client.creationRequests, <(String, String)>[
      ('P-1', 'Investigate mobile creation'),
    ]);
    expect(selectedTasks, <String>['T-new']);
  });

  testWidgets('creates a Task with a desktop prompt suggestion', (
    tester,
  ) async {
    final client = _WidgetClient();
    final controller = ProjectBoardController(
      client: client,
      storage: _WidgetStorage(),
    );
    await controller.refresh();
    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    await tester.tap(find.bySemanticsLabel('Create new Task'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '/release');
    await tester.pumpAndSettle();

    expect(find.text('skill:release-notes'), findsOneWidget);
    await tester.tap(find.text('skill:release-notes'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create Task'));
    await tester.pumpAndSettle();

    expect(client.promptCatalogRequests, <String>['P-1']);
    expect(client.creationRequests, <(String, String)>[
      ('P-1', '/skill:release-notes'),
    ]);
  });

  testWidgets('warns before retrying after an uncertain creation response', (
    tester,
  ) async {
    final client = _WidgetClient()
      ..creationError = const SocketException('response lost');
    final controller = ProjectBoardController(
      client: client,
      storage: _WidgetStorage(),
    );
    await controller.refresh();
    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    await tester.tap(find.bySemanticsLabel('Create new Task'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.byType(TextField),
      'Investigate mobile creation',
    );
    await tester.pump();
    await tester.tap(find.widgetWithText(FilledButton, 'Create Task'));
    await tester.pumpAndSettle();

    expect(
      find.text('Task may have been created. Check Backlog before retrying.'),
      findsOneWidget,
    );
    expect(client.creationRequests, hasLength(1));
    expect(find.text('Create Task'), findsWidgets);
  });

  testWidgets('the Project switcher changes scope and returns to Focus', (
    tester,
  ) async {
    final controller = ProjectBoardController(
      client: _WidgetClient(),
      storage: _WidgetStorage(),
    );
    await controller.refresh();
    controller.selectLane(ProjectBoardLane.backlog);
    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    await tester.tap(find.bySemanticsLabel(RegExp(r'Selected Project, Alpha')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Beta').last);
    await tester.pumpAndSettle();

    expect(controller.selectedProjectId, 'P-2');
    expect(controller.selectedLane, ProjectBoardLane.focus);
    expect(
      find.bySemanticsLabel(RegExp(r'Selected Project, Beta')),
      findsOneWidget,
    );
    expect(find.text('Focus Task'), findsOneWidget);
    expect(find.text('Backlog Task'), findsNothing);
  });
  testWidgets(
    'Task rows expose authoritative triage text and only open detail',
    (tester) async {
      final selectedTasks = <String>[];
      final controller = ProjectBoardController(
        client: _WidgetClient(),
        storage: _WidgetStorage(),
      );
      await controller.refresh();

      await tester.pumpWidget(
        MaterialApp(
          home: ProjectBoardHome(
            controller: controller,
            onTaskSelected: selectedTasks.add,
          ),
        ),
      );

      final row = find.bySemanticsLabel(
        RegExp(
          r'^Task T-focus, Focus Task, Needs Input, Waiting for your answer, ',
        ),
      );
      expect(row, findsOneWidget);
      await tester.tap(row);
      expect(selectedTasks, <String>['T-focus']);
      expect(find.text('Start'), findsNothing);
      expect(find.text('Complete'), findsNothing);
      expect(find.text('Delete'), findsNothing);
    },
  );

  testWidgets('Backlog cards mirror desktop task metadata and hierarchy', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(320, 700));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final controller = ProjectBoardController(
      client: _WidgetClient(),
      storage: _WidgetStorage(),
    );
    await controller.refresh();
    controller.selectLane(ProjectBoardLane.backlog);

    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    expect(find.text('T-backlog'), findsOneWidget);
    expect(find.text('Backlog Task'), findsOneWidget);
    expect(find.text('Backlog'), findsOneWidget);
    expect(find.text('2 deps'), findsOneWidget);
    expect(find.text('4 labels'), findsOneWidget);
    expect(find.text('2 PRs'), findsOneWidget);
    expect(find.text('PR #42'), findsOneWidget);
    expect(find.text('Waiting on 1 dep'), findsOneWidget);
    expect(find.text('mobile'), findsOneWidget);
    expect(find.text('review'), findsOneWidget);
    expect(find.text('urgent'), findsOneWidget);
    expect(find.text('overflow'), findsNothing);
    expect(find.text('5m ago'), findsOneWidget);
    expect(
      find.bySemanticsLabel(
        RegExp(
          r'^Task T-backlog, Backlog Task, Backlog, Ready to start, '
          r'2 dependencies, 4 labels: mobile, review, urgent, overflow, '
          r'2 pull requests, primary pull request 42, last activity ',
        ),
      ),
      findsOneWidget,
    );
  });

  testWidgets('cards show the full Task title without visual truncation', (
    tester,
  ) async {
    final controller = ProjectBoardController(
      client: _LongTitleWidgetClient(),
      storage: _WidgetStorage(),
    );
    await controller.refresh();
    controller.selectLane(ProjectBoardLane.backlog);

    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    expect(find.text(_longTaskTitle), findsOneWidget);
    expect(
      find.bySemanticsLabel(
        RegExp('^Task T-long, ${RegExp.escape(_longTaskTitle)}, Backlog,'),
      ),
      findsOneWidget,
    );
  });

  testWidgets('each lane has a calm lane-specific empty state', (tester) async {
    final controller = ProjectBoardController(
      client: _EmptyWidgetClient(),
      storage: _WidgetStorage(),
    );
    await controller.refresh();
    await tester.pumpWidget(
      MaterialApp(home: ProjectBoardHome(controller: controller)),
    );

    expect(find.text('Nothing needs your attention.'), findsOneWidget);
    await tester.tap(find.text('In Flight 0'));
    await tester.pump();
    expect(find.text('No Tasks are currently in flight.'), findsOneWidget);
    await tester.tap(find.text('Out of Focus 0'));
    await tester.pump();
    expect(find.text('No Tasks are set aside.'), findsOneWidget);
    await tester.tap(find.text('Backlog 0'));
    await tester.pump();
    expect(find.text('No Tasks are waiting in the Backlog.'), findsOneWidget);
  });

  testWidgets('returning from Task detail preserves the originating lane', (
    tester,
  ) async {
    final client = _CountingWidgetClient();
    final storage = _WidgetStorage();
    final controller = ProjectBoardController(client: client, storage: storage);
    await controller.refresh();
    controller.selectLane(ProjectBoardLane.backlog);

    await tester.pumpWidget(
      CompanionApp(
        initialState: const Connected(hostId: 'host-1', protocolVersion: 1),
        projectBoardController: controller,
        taskDetailControllerFactory: (taskId) => TaskDetailController(
          taskId: taskId,
          client: client,
          storage: storage,
        ),
      ),
    );
    await tester.pumpAndSettle();

    final row = find.bySemanticsLabel(
      RegExp(r'^Task T-backlog, Backlog Task, Backlog, Ready to start, '),
    );
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(find.text('Initial Prompt'), findsOneWidget);
    final beforeRefresh = (
      client.projectCatalogCalls,
      client.projectBoardCalls,
      client.taskDetailCalls,
    );
    await tester.tap(find.byTooltip('Refresh Task detail'));
    await tester.pumpAndSettle();
    expect(
      (
        client.projectCatalogCalls,
        client.projectBoardCalls,
        client.taskDetailCalls,
      ),
      (beforeRefresh.$1 + 1, beforeRefresh.$2 + 1, beforeRefresh.$3 + 1),
    );

    await tester.pageBack();
    await tester.pumpAndSettle();
    expect(controller.selectedLane, ProjectBoardLane.backlog);
    expect(find.text('Backlog Task'), findsOneWidget);
  });

  testWidgets('successful Delete refreshes Backlog before closing detail', (
    tester,
  ) async {
    final client = _CountingWidgetClient();
    final storage = _WidgetStorage();
    final controller = ProjectBoardController(client: client, storage: storage);
    await controller.refresh();
    controller.selectLane(ProjectBoardLane.backlog);
    await tester.pumpWidget(
      CompanionApp(
        initialState: const Connected(hostId: 'host-1', protocolVersion: 1),
        projectBoardController: controller,
        taskDetailControllerFactory: (taskId) => TaskDetailController(
          taskId: taskId,
          client: client,
          storage: storage,
        ),
      ),
    );
    await tester.pumpAndSettle();
    final boardCallsBeforeDelete = client.projectBoardCalls;

    await tester.tap(
      find.bySemanticsLabel(RegExp(r'^Task T-backlog, Backlog Task, Backlog,')),
    );
    await tester.pumpAndSettle();
    await tester.drag(find.byType(ListView), const Offset(0, -600));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(OutlinedButton, 'Delete Task'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Delete'));
    await tester.pumpAndSettle();

    expect(client.deleteCalls, 1);
    expect(client.projectBoardCalls, boardCallsBeforeDelete + 1);
    expect(controller.selectedLane, ProjectBoardLane.backlog);
    expect(find.text('Initial Prompt'), findsNothing);
    expect(find.text('Backlog Task'), findsNothing);
    expect(find.text('No Tasks are waiting in the Backlog.'), findsOneWidget);
  });

  testWidgets(
    'backlog Delete palette confirmation warns that deletion is permanent',
    (tester) async {
      final client = _WidgetClient();
      final storage = _WidgetStorage();
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      controller.selectLane(ProjectBoardLane.backlog);
      final paletteController = MobileActionPaletteController(
        taskClient: client,
        completionClient: client,
        paletteClient: client,
        storage: storage,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ProjectBoardHome(
            controller: controller,
            actionPaletteController: paletteController,
          ),
        ),
      );

      await tester.tap(find.byTooltip('Actions for Backlog Task'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(
        find.text(
          'Delete “Backlog Task”? This permanently deletes the Task and removes any runtime workspace state. The Task will not remain available as reference data. This cannot be undone.',
        ),
        findsOneWidget,
      );
      expect(
        find.textContaining('Completed Task stays available'),
        findsNothing,
      );
    },
  );

  testWidgets(
    'Task detail Delete palette confirmation warns that deletion is permanent',
    (tester) async {
      final client = _WidgetClient();
      final storage = _WidgetStorage();
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      controller.selectLane(ProjectBoardLane.backlog);
      final paletteController = MobileActionPaletteController(
        taskClient: client,
        completionClient: client,
        paletteClient: client,
        storage: storage,
      );
      await tester.pumpWidget(
        CompanionApp(
          initialState: const Connected(hostId: 'host-1', protocolVersion: 1),
          projectBoardController: controller,
          taskDetailControllerFactory: (taskId) => TaskDetailController(
            taskId: taskId,
            client: client,
            storage: storage,
          ),
          actionPaletteController: paletteController,
        ),
      );
      await tester.pumpAndSettle();

      await tester.tap(
        find.bySemanticsLabel(
          RegExp(r'^Task T-backlog, Backlog Task, Backlog,'),
        ),
      );
      await tester.pumpAndSettle();
      await tester.tap(find.byTooltip('Task actions'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Delete'));
      await tester.pumpAndSettle();

      expect(find.text('Delete “Backlog Task”?'), findsOneWidget);
      expect(
        find.text(
          'This permanently deletes the Task and removes any runtime workspace state. The Task will not remain available as reference data. This cannot be undone.',
        ),
        findsOneWidget,
      );
    },
  );

  testWidgets(
    'opens global and task-scoped Action Palettes from visible controls',
    (tester) async {
      final client = _WidgetClient();
      final storage = _WidgetStorage();
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      final paletteController = MobileActionPaletteController(
        taskClient: client,
        completionClient: client,
        paletteClient: client,
        storage: storage,
        onRefresh: controller.refresh,
      );

      await tester.pumpWidget(
        MaterialApp(
          home: ProjectBoardHome(
            controller: controller,
            actionPaletteController: paletteController,
          ),
        ),
      );

      await tester.tap(find.byTooltip('Actions'));
      await tester.pumpAndSettle();
      expect(find.text('New task'), findsOneWidget);
      expect(find.text('Refresh Board'), findsOneWidget);
      expect(find.text('Refresh GitHub'), findsOneWidget);
      await tester.tap(find.text('Refresh GitHub'));
      await tester.pumpAndSettle();
      expect(client.actionRequests, <String>['refresh-github']);

      await tester.tap(find.byTooltip('Actions for Focus Task'));
      await tester.pumpAndSettle();
      expect(find.text('Set aside'), findsOneWidget);
      expect(find.text('Complete'), findsOneWidget);
    },
  );

  testWidgets('shows the Companion GitHub refresh failure message', (
    tester,
  ) async {
    final client = _WidgetClient()
      ..githubRefreshError = const CompanionV1Exception(
        statusCode: 409,
        code: 'invalid_state',
        message:
            'GitHub token is not configured. Add one in desktop Settings, then try again.',
      );
    final storage = _WidgetStorage();
    final controller = ProjectBoardController(client: client, storage: storage);
    await controller.refresh();
    final paletteController = MobileActionPaletteController(
      taskClient: client,
      completionClient: client,
      paletteClient: client,
      storage: storage,
      onRefresh: controller.refresh,
    );

    await tester.pumpWidget(
      MaterialApp(
        home: ProjectBoardHome(
          controller: controller,
          actionPaletteController: paletteController,
        ),
      ),
    );

    await tester.tap(find.byTooltip('Actions'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Refresh GitHub'));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'GitHub token is not configured. Add one in desktop Settings, then try again.',
      ),
      findsOneWidget,
    );
    expect(find.text('Refresh GitHub completed.'), findsNothing);
  });
}

final class _LongTitleWidgetClient extends _WidgetClient {
  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async => ProjectBoard(
    snapshotAt: DateTime.now(),
    projectId: projectId,
    projectName: projectId == 'P-1' ? 'Alpha' : 'Beta',
    counts: const ProjectBoardCounts(
      focus: 0,
      inFlight: 0,
      outOfFocus: 0,
      backlog: 1,
    ),
    lanes: ProjectBoardLanes(
      focus: const <ProjectBoardTask>[],
      inFlight: const <ProjectBoardTask>[],
      outOfFocus: const <ProjectBoardTask>[],
      backlog: <ProjectBoardTask>[
        _task(
          'T-long',
          _longTaskTitle,
          ProjectBoardLane.backlog,
          'backlog',
          'Ready to start',
        ),
      ],
    ),
  );
}

final class _EmptyWidgetClient extends _WidgetClient {
  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async => _emptyBoard(projectId, projectId == 'P-1' ? 'Alpha' : 'Beta');
}

final class _CountingWidgetClient extends _WidgetClient {
  var projectCatalogCalls = 0;
  var projectBoardCalls = 0;
  var taskDetailCalls = 0;
  var deleteCalls = 0;
  var deleted = false;
  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) async {
    projectCatalogCalls += 1;
    return super.fetchProjectCatalog(trustRecord);
  }

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async {
    projectBoardCalls += 1;
    if (deleted) {
      return _emptyBoard(projectId, projectId == 'P-1' ? 'Alpha' : 'Beta');
    }
    return super.fetchProjectBoard(trustRecord, projectId);
  }

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    taskDetailCalls += 1;
    return super.fetchTaskDetail(trustRecord, taskId);
  }

  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    deleteCalls += 1;
    deleted = true;
    return TaskDeleteReceipt(taskId: taskId, outcome: 'deleted');
  }
}

ProjectBoard _board(String projectId, String projectName) => ProjectBoard(
  snapshotAt: DateTime.utc(2026, 8, 1),
  projectId: projectId,
  projectName: projectName,
  counts: const ProjectBoardCounts(
    focus: 1,
    inFlight: 1,
    outOfFocus: 1,
    backlog: 1,
  ),
  lanes: ProjectBoardLanes(
    focus: <ProjectBoardTask>[
      _task(
        'T-focus',
        'Focus Task',
        ProjectBoardLane.focus,
        'needs-input',
        'Waiting for your answer',
      ),
    ],
    inFlight: <ProjectBoardTask>[
      _task(
        'T-flight',
        'In Flight Task',
        ProjectBoardLane.inFlight,
        'ci-running',
        'Checks are running',
      ),
    ],
    outOfFocus: <ProjectBoardTask>[
      _task(
        'T-aside',
        'Set Aside Task',
        ProjectBoardLane.outOfFocus,
        'review-pending',
        'Set aside on desktop',
      ),
    ],
    backlog: <ProjectBoardTask>[
      _task(
        'T-backlog',
        'Backlog Task',
        ProjectBoardLane.backlog,
        'backlog',
        'Ready to start',
        dependencyCount: 2,
        waitingDependencyCount: 1,
        labels: const <String>['mobile', 'review', 'urgent', 'overflow'],
        pullRequestCount: 2,
        primaryPullRequestNumber: 42,
      ),
    ],
  ),
);

ProjectBoard _emptyBoard(String projectId, String projectName) => ProjectBoard(
  snapshotAt: DateTime.utc(2026, 8, 1),
  projectId: projectId,
  projectName: projectName,
  counts: const ProjectBoardCounts(
    focus: 0,
    inFlight: 0,
    outOfFocus: 0,
    backlog: 0,
  ),
  lanes: ProjectBoardLanes(
    focus: const <ProjectBoardTask>[],
    inFlight: const <ProjectBoardTask>[],
    outOfFocus: const <ProjectBoardTask>[],
    backlog: const <ProjectBoardTask>[],
  ),
);

ProjectBoardTask _task(
  String taskId,
  String title,
  ProjectBoardLane lane,
  String state,
  String reason, {
  int dependencyCount = 0,
  int waitingDependencyCount = 0,
  List<String> labels = const <String>[],
  int pullRequestCount = 0,
  int? primaryPullRequestNumber,
}) => ProjectBoardTask(
  taskId: taskId,
  title: title,
  lane: lane,
  state: state,
  reason: reason,
  activityAt: DateTime.now().subtract(const Duration(minutes: 5)),
  dependencyCount: dependencyCount,
  waitingDependencyCount: waitingDependencyCount,
  labels: labels,
  pullRequestCount: pullRequestCount,
  primaryPullRequestNumber: primaryPullRequestNumber,
);
