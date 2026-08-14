import '../client/companion_client.dart';
import '../generated/companion_v1_client.dart' as generated;
import '../storage/companion_secure_storage.dart';
import 'action_palette.dart';

typedef PaletteAuthoritativeRefresh = Future<void> Function();

final class ActionPaletteAuthorizationRequired implements Exception {
  const ActionPaletteAuthorizationRequired();
}

final class MobileActionPaletteController {
  factory MobileActionPaletteController({
    required CompanionClient taskClient,
    required CompanionTaskActionClient completionClient,
    required CompanionActionPaletteClient paletteClient,
    required CompanionSecureStorage storage,
    PaletteAuthoritativeRefresh? onRefresh,
    void Function()? onAuthorizationLost,
  }) => MobileActionPaletteController._(
    taskClient,
    completionClient,
    paletteClient,
    storage,
    onRefresh,
    onAuthorizationLost,
  );

  const MobileActionPaletteController._(
    this._taskClient,
    this._completionClient,
    this._paletteClient,
    this._storage,
    this._onRefresh,
    this._onAuthorizationLost,
  );

  final CompanionClient _taskClient;
  final CompanionTaskActionClient _completionClient;
  final CompanionActionPaletteClient _paletteClient;
  final CompanionSecureStorage _storage;
  final PaletteAuthoritativeRefresh? _onRefresh;
  final void Function()? _onAuthorizationLost;

  Future<List<MobilePaletteAction>> loadProjectActions(String projectId) async {
    final trustRecord = await _trustRecord();
    final snapshot = await _paletteClient.fetchProjectActions(
      trustRecord,
      projectId,
    );
    if (snapshot.projectId != projectId) {
      throw const FormatException(
        'Project action snapshot did not match the request.',
      );
    }
    return snapshot.actions
        .map(MobilePaletteActionContractAdapter.fromProjectPresentation)
        .toList(growable: false);
  }

  Future<List<MobilePaletteAction>> loadTaskActions(String taskId) async {
    final trustRecord = await _trustRecord();
    final snapshot = await _paletteClient.fetchTaskActions(trustRecord, taskId);
    if (snapshot.taskId != taskId) {
      throw const FormatException(
        'Task action snapshot did not match the request.',
      );
    }
    return snapshot.actions
        .map(MobilePaletteActionContractAdapter.fromTaskPresentation)
        .toList(growable: false);
  }

  Future<void> executeTaskAction(
    String taskId,
    CompanionActionId action,
  ) async {
    final trustRecord = await _trustRecord();
    try {
      switch (action) {
        case CompanionActionId.startTask:
          final result = await _taskClient.startTask(trustRecord, taskId);
          if (result.taskId != taskId ||
              result.outcome != generated.TaskStartOutcome.started) {
            throw const FormatException('Invalid Task Start result.');
          }
        case CompanionActionId.deleteTask:
          final result = await _taskClient.deleteBacklogTask(
            trustRecord,
            taskId,
          );
          if (result.taskId != taskId || result.outcome != 'deleted') {
            throw const FormatException('Invalid Task Delete result.');
          }
        case CompanionActionId.completeTask:
          final result = await _completionClient.completeTask(
            trustRecord,
            taskId,
          );
          if (result.taskId != taskId || result.boardStatus != 'done') {
            throw const FormatException('Invalid Task Complete result.');
          }
        case CompanionActionId.setAsideTask:
          await _paletteClient.setAsideTask(trustRecord, taskId);
        case CompanionActionId.returnToBoard:
          await _paletteClient.returnTaskToBoard(trustRecord, taskId);
        case CompanionActionId.mergePullRequest:
          await _paletteClient.mergeTaskPullRequest(trustRecord, taskId);
        case CompanionActionId.enqueuePullRequest:
          await _paletteClient.enqueueTaskPullRequest(trustRecord, taskId);
        case CompanionActionId.runApp:
          await _paletteClient.runTaskApp(trustRecord, taskId);
        case CompanionActionId.newTask ||
            CompanionActionId.refreshBoard ||
            CompanionActionId.refreshGithub:
          throw ArgumentError.value(action, 'action', 'Task action required.');
      }
      await _onRefresh?.call();
    } on generated.CompanionV1Exception catch (error) {
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _onAuthorizationLost?.call();
      } else {
        await _onRefresh?.call();
      }
      rethrow;
    } on Object {
      await _onRefresh?.call();
      rethrow;
    }
  }

  Future<void> refreshProjectGithub(String projectId) async {
    final trustRecord = await _trustRecord();
    try {
      await _paletteClient.refreshProjectGithub(trustRecord, projectId);
      await _onRefresh?.call();
    } on generated.CompanionV1Exception catch (error) {
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _onAuthorizationLost?.call();
      } else {
        await _onRefresh?.call();
      }
      rethrow;
    } on Object {
      await _onRefresh?.call();
      rethrow;
    }
  }

  Future<CompanionTrustRecord> _trustRecord() async {
    final trustRecord = await _storage.load();
    if (trustRecord == null) {
      _onAuthorizationLost?.call();
      throw const ActionPaletteAuthorizationRequired();
    }
    return trustRecord;
  }
}
