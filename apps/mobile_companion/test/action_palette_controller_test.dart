import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette.dart';
import 'package:openforge_companion/src/action_palette/action_palette_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

CompanionTaskActionPresentation _taskAction(
  CompanionTaskActionId id,
  String label,
  CompanionActionIcon icon, {
  bool requiresConfirmation = false,
  bool destructive = false,
}) => CompanionTaskActionPresentation(
  id: id,
  label: label,
  keywords: <String>[label.toLowerCase()],
  icon: icon,
  requiresConfirmation: requiresConfirmation,
  destructive: destructive,
);

CompanionProjectActionPresentation _projectAction(
  CompanionProjectActionId id,
  String label,
  CompanionActionIcon icon,
) => CompanionProjectActionPresentation(
  id: id,
  label: label,
  keywords: <String>[label.toLowerCase()],
  icon: icon,
  requiresConfirmation: false,
  destructive: false,
);

final class _Storage implements CompanionSecureStorage {
  final record = CompanionTrustRecord(
    hostId: 'host-1',
    certificateSha256: 'AA:BB',
    endpointCandidates: <Uri>[Uri.parse('https://desktop.local')],
    deviceId: 'device-1',
    deviceCredential: 'credential',
  );

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'Unexpected storage call: ${invocation.memberName}',
  );
}

final class _Client
    implements
        CompanionClient,
        CompanionTaskActionClient,
        CompanionActionPaletteClient {
  final calls = <String>[];

  @override
  Future<ProjectActionsSnapshot> fetchProjectActions(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) async => ProjectActionsSnapshot(
    projectId: projectId,
    actions: <CompanionProjectActionPresentation>[
      _projectAction(
        CompanionProjectActionId.refreshGithub,
        'Refresh GitHub',
        CompanionActionIcon.refresh,
      ),
    ],
  );

  @override
  Future<TaskActionsSnapshot> fetchTaskActions(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => TaskActionsSnapshot(
    taskId: taskId,
    actions: <CompanionTaskActionPresentation>[
      _taskAction(
        CompanionTaskActionId.mergePullRequest,
        'Merge Pull Request',
        CompanionActionIcon.merge,
        requiresConfirmation: false,
      ),
      _taskAction(
        CompanionTaskActionId.setAsideTask,
        'Set aside',
        CompanionActionIcon.visibilityOff,
      ),
      _taskAction(
        CompanionTaskActionId.completeTask,
        'Complete',
        CompanionActionIcon.complete,
        requiresConfirmation: true,
        destructive: true,
      ),
    ],
  );

  @override
  Future<void> mergeTaskPullRequest(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => calls.add('merge:$taskId');

  @override
  Future<void> setAsideTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => calls.add('set-aside:$taskId');

  @override
  Future<TaskCompleteResult> completeTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async {
    calls.add('complete:$taskId');
    return TaskCompleteResult(
      taskId: taskId,
      boardStatus: 'done',
      cleanupScheduled: false,
    );
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => throw UnsupportedError(
    'Unexpected client call: ${invocation.memberName}',
  );
}

void main() {
  test('loads server-advertised Task actions in authoritative order', () async {
    final client = _Client();
    final controller = MobileActionPaletteController(
      taskClient: client,
      completionClient: client,
      paletteClient: client,
      storage: _Storage(),
    );

    final actions = await controller.loadTaskActions('T-1');

    expect(actions.map((action) => action.id), <CompanionActionId>[
      CompanionActionId.mergePullRequest,
      CompanionActionId.setAsideTask,
      CompanionActionId.completeTask,
    ]);
    expect(actions.first.label, 'Merge Pull Request');
    expect(actions.first.keywords, <String>['merge pull request']);
    expect(actions.first.requiresConfirmation, isFalse);
    expect(actions.last.destructive, isTrue);
  });

  test(
    'loads server-advertised Project actions without guessing capabilities',
    () async {
      final client = _Client();
      final controller = MobileActionPaletteController(
        taskClient: client,
        completionClient: client,
        paletteClient: client,
        storage: _Storage(),
      );

      final actions = await controller.loadProjectActions('P-1');

      expect(actions.map((action) => action.id), <CompanionActionId>[
        CompanionActionId.refreshGithub,
      ]);
      expect(actions.single.label, 'Refresh GitHub');
      expect(actions.single.keywords, <String>['refresh github']);
    },
  );

  test(
    'dispatches explicit mutations once and refreshes authoritative state',
    () async {
      final client = _Client();
      var refreshes = 0;
      final controller = MobileActionPaletteController(
        taskClient: client,
        completionClient: client,
        paletteClient: client,
        storage: _Storage(),
        onRefresh: () async => refreshes += 1,
      );

      await controller.executeTaskAction(
        'T-1',
        CompanionActionId.mergePullRequest,
      );
      await controller.executeTaskAction('T-1', CompanionActionId.completeTask);

      expect(client.calls, <String>['merge:T-1', 'complete:T-1']);
      expect(refreshes, 2);
    },
  );
}
