import '../client/companion_refresh_outcome.dart';
import '../generated/companion_v1_client.dart';

sealed class TaskDetailViewState {
  const TaskDetailViewState();
}

final class TaskDetailLoading extends TaskDetailViewState {
  const TaskDetailLoading();
}

enum TaskDeletePhase { idle, pending, failed, uncertain }

enum TaskDeleteResult {
  succeeded,
  failed,
  uncertain,
  authorizationRequired,
  ignored,
}

final class TaskDetailLoaded extends TaskDetailViewState {
  const TaskDetailLoaded(
    this.detail, {
    this.deletePhase = TaskDeletePhase.idle,
    this.deleteMessage,
  });

  final TaskDetail detail;
  final TaskDeletePhase deletePhase;
  final String? deleteMessage;
}

final class TaskDetailNotFound extends TaskDetailViewState {
  const TaskDetailNotFound();
}

final class TaskDetailAuthorizationRequired extends TaskDetailViewState {
  const TaskDetailAuthorizationRequired();
}

final class TaskDetailIncompatible extends TaskDetailViewState {
  const TaskDetailIncompatible();
}

final class TaskDetailUnavailable extends TaskDetailViewState {
  const TaskDetailUnavailable();
}

enum TaskCompleteAttempt { completed, failed, alreadyPending }

sealed class TaskStartActionState {
  const TaskStartActionState();

  String get message => '';
}

final class TaskStartIdle extends TaskStartActionState {
  const TaskStartIdle();
}

final class TaskStartPending extends TaskStartActionState {
  const TaskStartPending();
}

final class TaskStartDesktopActionRequired extends TaskStartActionState {
  const TaskStartDesktopActionRequired();

  @override
  String get message =>
      'Open this Task on the desktop to resolve its workspace before starting.';
}

final class TaskStartFailed extends TaskStartActionState {
  const TaskStartFailed(this._message);

  final String _message;

  @override
  String get message => _message;
}

final class TaskStartUncertain extends TaskStartActionState {
  const TaskStartUncertain({required this.authorityRefreshed});

  final bool authorityRefreshed;

  @override
  String get message => authorityRefreshed
      ? 'The Start result could not be confirmed. Current Task and Board state were refreshed before retry.'
      : 'The Start result and current Board state could not be confirmed. Return to the Board and refresh before retrying.';
}

typedef TaskBoardRefresh = Future<CompanionRefreshOutcome> Function();
