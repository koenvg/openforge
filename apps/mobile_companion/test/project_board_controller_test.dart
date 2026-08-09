import 'dart:async';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/project_board/project_board_controller.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

final class _FakeClient implements CompanionClient {
  ProjectCatalog catalog = ProjectCatalog(
    snapshotAt: DateTime.utc(2026, 8, 1),
    projects: const <ProjectCatalogItem>[
      ProjectCatalogItem(projectId: 'P-1', name: 'Alpha'),
      ProjectCatalogItem(projectId: 'P-2', name: 'Beta'),
    ],
  );
  final List<String> boardRequests = <String>[];
  final Map<String, Completer<ProjectBoard>> pendingBoards =
      <String, Completer<ProjectBoard>>{};

  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) async => catalog;

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async {
    boardRequests.add(projectId);
    final pending = pendingBoards[projectId];
    if (pending != null) return pending.future;
    final project = catalog.projects.singleWhere(
      (candidate) => candidate.projectId == projectId,
    );
    return _board(project.projectId, project.name);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'Unexpected client call: ${invocation.memberName}',
  );
}

final class _FakeStorage implements CompanionProjectStorage {
  CompanionTrustRecord? record = CompanionTrustRecord(
    hostId: 'host-1',
    certificateSha256: 'AA:BB',
    endpointCandidates: <Uri>[Uri.parse('https://openforge.local')],
    deviceId: 'device-1',
    deviceCredential: 'credential',
  );
  final Map<String, String> selections = <String, String>{};
  final List<(String, String)> savedSelections = <(String, String)>[];
  final List<String> selectionSaveStarts = <String>[];
  final Map<String, Completer<void>> delayedSelectionSaves =
      <String, Completer<void>>{};

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<String?> loadSelectedProject(String hostId) async =>
      selections[hostId];

  @override
  Future<void> saveSelectedProject(String hostId, String projectId) async {
    selectionSaveStarts.add(projectId);
    await delayedSelectionSaves[projectId]?.future;
    selections[hostId] = projectId;
    savedSelections.add((hostId, projectId));
  }

  @override
  Future<void> clearSelectedProject(String hostId) async {
    selections.remove(hostId);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'Unexpected storage call: ${invocation.memberName}',
  );
}

void main() {
  test('restores a valid host-scoped Selected Project', () async {
    final client = _FakeClient();
    final storage = _FakeStorage()..selections['host-1'] = 'P-2';
    final controller = ProjectBoardController(client: client, storage: storage);

    await controller.refresh();

    final state = controller.state as ProjectBoardLoaded;
    expect(state.selectedProjectId, 'P-2');
    expect(state.board.projectName, 'Beta');
    expect(client.boardRequests, <String>['P-2']);
    expect(storage.savedSelections, isEmpty);
  });

  test(
    'falls back to the first visible Project and persists it per host',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage()..selections['host-1'] = 'P-hidden';
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );

      await controller.refresh();

      expect((controller.state as ProjectBoardLoaded).selectedProjectId, 'P-1');
      expect(storage.selections['host-1'], 'P-1');
      expect(storage.savedSelections, <(String, String)>[('host-1', 'P-1')]);
    },
  );

  test(
    'clears selection and shows a no-Projects state for an empty catalog',
    () async {
      final client = _FakeClient()
        ..catalog = ProjectCatalog(
          snapshotAt: DateTime.utc(2026, 8, 1),
          projects: const <ProjectCatalogItem>[],
        );
      final storage = _FakeStorage()..selections['host-1'] = 'P-1';
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );

      await controller.refresh();

      expect(controller.state, isA<ProjectBoardNoProjects>());
      expect(storage.selections, isEmpty);
      expect(client.boardRequests, isEmpty);
    },
  );

  test(
    'Project switching selects Focus and clears previous lane positions',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage();
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      controller.selectLane(ProjectBoardLane.backlog);
      controller.rememberScrollOffset(ProjectBoardLane.focus, 18);
      controller.rememberScrollOffset(ProjectBoardLane.backlog, 72);

      final switching = controller.selectProject('P-2');

      final loading = controller.state as ProjectBoardLoading;
      expect(loading.selectedProjectId, 'P-2');
      expect(controller.selectedLane, ProjectBoardLane.focus);
      expect(controller.scrollOffsetFor(ProjectBoardLane.focus), 0);
      expect(controller.scrollOffsetFor(ProjectBoardLane.backlog), 0);
      await switching;
      expect((controller.state as ProjectBoardLoaded).board.projectId, 'P-2');
    },
  );

  test('tab selection keeps independent in-memory lane positions', () async {
    final controller = ProjectBoardController(
      client: _FakeClient(),
      storage: _FakeStorage(),
    );
    await controller.refresh();

    controller.rememberScrollOffset(ProjectBoardLane.focus, 24);
    controller.selectLane(ProjectBoardLane.inFlight);
    controller.rememberScrollOffset(ProjectBoardLane.inFlight, 96);
    controller.selectLane(ProjectBoardLane.focus);

    expect(controller.selectedLane, ProjectBoardLane.focus);
    expect(controller.scrollOffsetFor(ProjectBoardLane.focus), 24);
    expect(controller.scrollOffsetFor(ProjectBoardLane.inFlight), 96);
  });

  test(
    'authoritative refresh preserves the originating lane and position',
    () async {
      final controller = ProjectBoardController(
        client: _FakeClient(),
        storage: _FakeStorage(),
      );
      await controller.refresh();
      controller.selectLane(ProjectBoardLane.outOfFocus);
      controller.rememberScrollOffset(ProjectBoardLane.outOfFocus, 128);

      await controller.refresh();

      expect(controller.selectedLane, ProjectBoardLane.outOfFocus);
      expect(controller.scrollOffsetFor(ProjectBoardLane.outOfFocus), 128);
    },
  );
  test(
    'catalog fallback changes Project and resets lane context to Focus',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage()..selections['host-1'] = 'P-2';
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      controller.selectLane(ProjectBoardLane.backlog);
      controller.rememberScrollOffset(ProjectBoardLane.backlog, 64);
      client.catalog = ProjectCatalog(
        snapshotAt: DateTime.utc(2026, 8, 1, 13),
        projects: const <ProjectCatalogItem>[
          ProjectCatalogItem(projectId: 'P-1', name: 'Alpha'),
        ],
      );

      await controller.refresh();

      expect(controller.selectedProjectId, 'P-1');
      expect(controller.selectedLane, ProjectBoardLane.focus);
      expect(controller.scrollOffsetFor(ProjectBoardLane.backlog), 0);
    },
  );

  test(
    'rapid Project switches persist the latest selection in order',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage()..selections['host-1'] = 'P-1';
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      final delayed = Completer<void>();
      storage.delayedSelectionSaves['P-2'] = delayed;

      final firstSwitch = controller.selectProject('P-2');
      await Future<void>.delayed(Duration.zero);
      final latestSwitch = controller.selectProject('P-1');
      await Future<void>.delayed(Duration.zero);

      expect(storage.selectionSaveStarts, <String>['P-2']);
      delayed.complete();
      await Future.wait(<Future<void>>[firstSwitch, latestSwitch]);
      expect(storage.selectionSaveStarts, <String>['P-2', 'P-1']);
      expect(storage.selections['host-1'], 'P-1');
    },
  );
  test(
    'a superseded Project request cannot replace the current Board',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage();
      final controller = ProjectBoardController(
        client: client,
        storage: storage,
      );
      await controller.refresh();
      final delayed = Completer<ProjectBoard>();
      client.pendingBoards['P-2'] = delayed;

      final staleSwitch = controller.selectProject('P-2');
      await Future<void>.delayed(Duration.zero);
      await controller.selectProject('P-1');
      delayed.complete(_board('P-2', 'Beta'));
      await staleSwitch;

      final state = controller.state as ProjectBoardLoaded;
      expect(state.selectedProjectId, 'P-1');
      expect(state.board.projectId, 'P-1');
    },
  );
}

ProjectBoard _board(String projectId, String projectName) => ProjectBoard(
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
    focus: <ProjectBoardTask>[],
    inFlight: <ProjectBoardTask>[],
    outOfFocus: <ProjectBoardTask>[],
    backlog: <ProjectBoardTask>[],
  ),
);
