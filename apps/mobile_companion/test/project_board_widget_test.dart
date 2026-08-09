import 'dart:ui' show SemanticsAction;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/project_board/project_board_controller.dart';
import 'package:openforge_companion/src/project_board/project_board_home.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

final class _WidgetClient implements CompanionClient {
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
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => TaskDetail(
    taskId: taskId,
    title: 'Backlog Task',
    projectId: 'P-1',
    projectName: 'Alpha',
    boardStatus: 'backlog',
    handoffNotes: null,
    agentState: 'waiting',
    agentErrorSummary: null,
    createdAt: DateTime.utc(2026, 8, 1, 10),
    updatedAt: DateTime.utc(2026, 8, 1, 11),
    agentUpdatedAt: null,
  );
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
        RegExp(r'^Task Focus Task, Needs input, Waiting for your answer, '),
      );
      expect(row, findsOneWidget);
      await tester.tap(row);
      expect(selectedTasks, <String>['T-focus']);
      expect(find.text('Start'), findsNothing);
      expect(find.text('Complete'), findsNothing);
      expect(find.text('Delete'), findsNothing);
    },
  );

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
      RegExp(r'^Task Backlog Task, Backlog, Ready to start, '),
    );
    await tester.tap(row);
    await tester.pumpAndSettle();
    expect(find.text('Handoff Notes'), findsOneWidget);
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
  String reason,
) => ProjectBoardTask(
  taskId: taskId,
  title: title,
  lane: lane,
  state: state,
  reason: reason,
  activityAt: DateTime.utc(2026, 8, 1, 12),
);
