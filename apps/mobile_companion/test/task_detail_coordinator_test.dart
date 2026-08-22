import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/project_board/project_board_controller.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';
import 'package:openforge_companion/src/task_detail/task_detail_coordinator.dart';

void main() {
  testWidgets(
    'Task detail coordinator restores nested live ownership and refreshes detail with Board',
    (tester) async {
      final client = _TaskClient();
      final storage = _ProjectStorage();
      final board = ProjectBoardController(client: client, storage: storage);
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(navigatorKey: navigatorKey, home: const SizedBox.shrink()),
      );
      final owners = <String?>[];
      final coordinator = TaskDetailCoordinator(
        navigatorKey: navigatorKey,
        controllerFactory: (taskId) => TaskDetailController(
          taskId: taskId,
          client: client,
          storage: storage,
        ),
        projectBoardController: board,
        onOpenTaskChanged: (controller) => owners.add(controller?.taskId),
      );
      addTearDown(board.dispose);
      await board.refresh();
      expect(board.selectedProjectId, 'P-1');

      unawaited(coordinator.openTask('T-1'));
      await tester.pumpAndSettle();
      expect(find.text('Task T-1'), findsOneWidget);

      coordinator.openRelatedTask('T-2', 'P-2');
      await tester.pumpAndSettle();
      expect(find.text('Task T-2'), findsOneWidget);
      expect(board.selectedProjectId, 'P-2');

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(find.text('Task T-1'), findsOneWidget);
      expect(owners, <String?>['T-1', 'T-2', 'T-1']);

      final detail = coordinator.openTaskController!;
      await coordinator.refreshTaskAndBoard(detail);
      expect(client.boardCalls, 3);
      expect(client.detailCalls['T-1'], 2);

      await tester.pageBack();
      await tester.pumpAndSettle();
      expect(owners.last, isNull);
    },
  );
}

final class _TaskClient implements CompanionClient {
  var boardCalls = 0;
  final detailCalls = <String, int>{};

  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) async => ProjectCatalog(
    snapshotAt: DateTime.utc(2026, 1, 1),
    projects: <ProjectCatalogItem>[
      const ProjectCatalogItem(projectId: 'P-1', name: 'OpenForge'),
      const ProjectCatalogItem(projectId: 'P-2', name: 'Release Tools'),
    ],
  );

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async {
    boardCalls += 1;
    return ProjectBoard(
      snapshotAt: DateTime.utc(2026, 1, 1),
      projectId: projectId,
      projectName: 'OpenForge',
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
  }

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    detailCalls.update(taskId, (count) => count + 1, ifAbsent: () => 1);
    return TaskDetail(
      taskId: taskId,
      initialPrompt: 'Inspect $taskId',
      title: 'Task $taskId',
      projectId: 'P-1',
      projectName: 'OpenForge',
      boardStatus: 'doing',
      agentState: 'running',
      agentErrorSummary: null,
      createdAt: DateTime.utc(2026, 1, 1),
      updatedAt: DateTime.utc(2026, 1, 1),
      agentUpdatedAt: null,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _ProjectStorage implements CompanionProjectStorage {
  final record = CompanionTrustRecord(
    hostId: 'host-1',
    certificateSha256: 'AA:BB:CC',
    endpointCandidates: <Uri>[Uri.parse('https://desktop.invalid')],
    deviceId: 'device-1',
    deviceCredential: 'secret',
  );

  @override
  Future<void> clearSelectedProject(String hostId) async {}

  @override
  Future<void> forget() async {}

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<String?> loadSelectedProject(String hostId) async => 'P-1';

  @override
  Future<void> save(CompanionTrustRecord record) async {}

  @override
  Future<void> saveSelectedProject(String hostId, String projectId) async {}
}
