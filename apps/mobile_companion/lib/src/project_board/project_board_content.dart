part of 'project_board_home.dart';

class _ProjectBoardBody extends StatelessWidget {
  const _ProjectBoardBody({
    required this.state,
    required this.lane,
    required this.scrollController,
    required this.onRefresh,
    required this.onTaskSelected,
  });

  final ProjectBoardViewState state;
  final ProjectBoardLane lane;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;
  final ValueChanged<String>? onTaskSelected;

  @override
  Widget build(BuildContext context) => switch (state) {
    ProjectBoardLoading(:final projects, :final selectedProjectId) => Center(
      child: Semantics(
        liveRegion: true,
        label: _loadingLabel(projects, selectedProjectId),
        child: const CircularProgressIndicator(),
      ),
    ),
    ProjectBoardNoProjects() => const _BoardMessage(
      icon: Icons.folder_off_outlined,
      title: 'No visible Projects',
      message: 'Show a Project on the desktop to use the Mobile Project Board.',
      semanticsLabel:
          'No visible Projects. Show a Project on the desktop to use the Mobile Project Board.',
    ),
    ProjectBoardLoadError(:final message) => _BoardError(
      message: message,
      onRefresh: onRefresh,
    ),
    ProjectBoardLoaded(:final board) => _LaneView(
      lane: lane,
      tasks: _tasksFor(board, lane),
      scrollController: scrollController,
      onRefresh: onRefresh,
      onTaskSelected: onTaskSelected,
    ),
  };
}

class _LaneView extends StatelessWidget {
  const _LaneView({
    required this.lane,
    required this.tasks,
    required this.scrollController,
    required this.onRefresh,
    required this.onTaskSelected,
  });

  final ProjectBoardLane lane;
  final List<ProjectBoardTask> tasks;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;
  final ValueChanged<String>? onTaskSelected;

  @override
  Widget build(BuildContext context) => RefreshIndicator(
    onRefresh: onRefresh,
    child: tasks.isEmpty
        ? ListView(
            controller: scrollController,
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.all(32),
            children: <Widget>[
              const SizedBox(height: 96),
              _LaneEmpty(lane: lane),
            ],
          )
        : ListView.builder(
            controller: scrollController,
            physics: const AlwaysScrollableScrollPhysics(),
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
            itemCount: tasks.length,
            itemBuilder: (context, index) {
              final task = tasks[index];
              return _BoardTaskRow(
                task: task,
                onTap: onTaskSelected == null
                    ? null
                    : () => onTaskSelected!(task.taskId),
              );
            },
          ),
  );
}

class _LaneEmpty extends StatelessWidget {
  const _LaneEmpty({required this.lane});

  final ProjectBoardLane lane;

  @override
  Widget build(BuildContext context) {
    final (icon, message) = switch (lane) {
      ProjectBoardLane.focus => (
        Icons.check_circle_outline,
        'Nothing needs your attention.',
      ),
      ProjectBoardLane.inFlight => (
        Icons.flight_takeoff_outlined,
        'No Tasks are currently in flight.',
      ),
      ProjectBoardLane.outOfFocus => (
        Icons.visibility_off_outlined,
        'No Tasks are set aside.',
      ),
      ProjectBoardLane.backlog => (
        Icons.inventory_2_outlined,
        'No Tasks are waiting in the Backlog.',
      ),
    };
    return Semantics(
      container: true,
      label: message,
      child: ExcludeSemantics(
        child: Column(
          children: <Widget>[
            Icon(icon, size: 56, color: Theme.of(context).colorScheme.primary),
            const SizedBox(height: 16),
            Text(
              message,
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}

class _BoardTaskRow extends StatelessWidget {
  const _BoardTaskRow({required this.task, required this.onTap});

  final ProjectBoardTask task;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final state = _stateLabel(task.state);
    final relativeActivity = _relativeActivity(task.activityAt, DateTime.now());
    final visibleLabels = task.lane == ProjectBoardLane.backlog
        ? task.labels.take(3).toList(growable: false)
        : const <String>[];
    return Semantics(
      container: true,
      button: onTap != null,
      label: _taskSemanticsLabel(context, task, state, relativeActivity),
      child: ExcludeSemantics(
        child: Card(
          margin: const EdgeInsets.only(bottom: 12),
          clipBehavior: Clip.antiAlias,
          child: InkWell(
            onTap: onTap,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Expanded(
                            child: Wrap(
                              spacing: 8,
                              runSpacing: 8,
                              crossAxisAlignment: WrapCrossAlignment.center,
                              children: <Widget>[
                                Text(
                                  task.taskId,
                                  style: Theme.of(context).textTheme.labelMedium
                                      ?.copyWith(
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.primary,
                                        fontWeight: FontWeight.w700,
                                      ),
                                ),
                                _StateBadge(state: task.state, label: state),
                              ],
                            ),
                          ),
                          const SizedBox(width: 12),
                          Flexible(
                            child: Wrap(
                              alignment: WrapAlignment.end,
                              spacing: 10,
                              runSpacing: 6,
                              children: <Widget>[
                                if (task.dependencyCount > 0)
                                  _MetadataItem(
                                    icon: Icons.link,
                                    text: _pluralize(
                                      task.dependencyCount,
                                      'dep',
                                    ),
                                  ),
                                if (task.lane == ProjectBoardLane.backlog &&
                                    task.labels.isNotEmpty)
                                  _MetadataItem(
                                    icon: Icons.label_outline,
                                    text: _pluralize(
                                      task.labels.length,
                                      'label',
                                    ),
                                  ),
                                if (task.pullRequestCount > 0)
                                  _MetadataItem(
                                    icon: Icons.call_split,
                                    text: _pluralize(
                                      task.pullRequestCount,
                                      'PR',
                                    ),
                                  ),
                                Text(
                                  relativeActivity,
                                  style: Theme.of(context).textTheme.bodySmall
                                      ?.copyWith(
                                        color: Theme.of(
                                          context,
                                        ).colorScheme.onSurfaceVariant,
                                      ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _truncateTaskTitle(task.title),
                        style: Theme.of(context).textTheme.titleMedium
                            ?.copyWith(fontWeight: FontWeight.w600),
                      ),
                      if (visibleLabels.isNotEmpty) ...<Widget>[
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: visibleLabels
                              .map(
                                (label) => Chip(
                                  label: Text(label),
                                  visualDensity: VisualDensity.compact,
                                  materialTapTargetSize:
                                      MaterialTapTargetSize.shrinkWrap,
                                ),
                              )
                              .toList(growable: false),
                        ),
                      ],
                      if (task.primaryPullRequestNumber
                          case final number?) ...<Widget>[
                        const SizedBox(height: 12),
                        DecoratedBox(
                          decoration: BoxDecoration(
                            color: Theme.of(
                              context,
                            ).colorScheme.primaryContainer,
                            borderRadius: BorderRadius.circular(6),
                          ),
                          child: Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: 8,
                              vertical: 4,
                            ),
                            child: Text(
                              'PR #$number',
                              style: Theme.of(context).textTheme.labelSmall
                                  ?.copyWith(
                                    color: Theme.of(
                                      context,
                                    ).colorScheme.onPrimaryContainer,
                                    fontWeight: FontWeight.w600,
                                  ),
                            ),
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerLow,
                    border: Border(
                      top: BorderSide(
                        color: Theme.of(context).colorScheme.outlineVariant,
                      ),
                    ),
                  ),
                  child: Row(
                    children: <Widget>[
                      Expanded(
                        child: Text(
                          task.reason,
                          style: Theme.of(context).textTheme.bodySmall
                              ?.copyWith(
                                color: Theme.of(
                                  context,
                                ).colorScheme.onSurfaceVariant,
                              ),
                        ),
                      ),
                      if (task.waitingDependencyCount > 0) ...<Widget>[
                        const SizedBox(width: 12),
                        _DependencyWarning(count: task.waitingDependencyCount),
                      ],
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _StateBadge extends StatelessWidget {
  const _StateBadge({required this.state, required this.label});

  final String state;
  final String label;

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    final (background, foreground) = switch (state) {
      'active' || 'agent-done' => (
        colorScheme.tertiaryContainer,
        colorScheme.onTertiaryContainer,
      ),
      'needs-input' || 'unaddressed-comments' => (
        colorScheme.secondaryContainer,
        colorScheme.onSecondaryContainer,
      ),
      'failed' || 'ci-failed' || 'changes-requested' || 'merge-conflict' => (
        colorScheme.errorContainer,
        colorScheme.onErrorContainer,
      ),
      'ready-to-merge' || 'ready-to-enqueue' || 'pr-queued' => (
        colorScheme.primaryContainer,
        colorScheme.onPrimaryContainer,
      ),
      _ => (colorScheme.surfaceContainerHighest, colorScheme.onSurfaceVariant),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: background,
        borderRadius: BorderRadius.circular(999),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
        child: Text(
          label,
          style: Theme.of(context).textTheme.labelSmall?.copyWith(
            color: foreground,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

class _MetadataItem extends StatelessWidget {
  const _MetadataItem({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Row(
    mainAxisSize: MainAxisSize.min,
    children: <Widget>[
      Icon(
        icon,
        size: 14,
        color: Theme.of(context).colorScheme.onSurfaceVariant,
      ),
      const SizedBox(width: 4),
      Text(
        text,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(
          color: Theme.of(context).colorScheme.onSurfaceVariant,
        ),
      ),
    ],
  );
}

class _DependencyWarning extends StatelessWidget {
  const _DependencyWarning({required this.count});

  final int count;

  @override
  Widget build(BuildContext context) => DecoratedBox(
    decoration: BoxDecoration(
      color: Theme.of(context).colorScheme.secondaryContainer,
      borderRadius: BorderRadius.circular(999),
    ),
    child: Padding(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Icon(
            Icons.warning_amber_rounded,
            size: 14,
            color: Theme.of(context).colorScheme.onSecondaryContainer,
          ),
          const SizedBox(width: 4),
          Text(
            'Waiting on ${_pluralize(count, 'dep')}',
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: Theme.of(context).colorScheme.onSecondaryContainer,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    ),
  );
}

class _BoardMessage extends StatelessWidget {
  const _BoardMessage({
    required this.icon,
    required this.title,
    required this.message,
    required this.semanticsLabel,
  });

  final IconData icon;
  final String title;
  final String message;
  final String semanticsLabel;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Semantics(
        container: true,
        label: semanticsLabel,
        child: ExcludeSemantics(
          child: Column(
            children: <Widget>[
              Icon(
                icon,
                size: 64,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 24),
              Text(
                title,
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                message,
                style: Theme.of(context).textTheme.bodyLarge,
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      ),
    ),
  );
}

class _BoardError extends StatelessWidget {
  const _BoardError({required this.message, required this.onRefresh});

  final String message;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Semantics(
        container: true,
        liveRegion: true,
        label: 'Mobile Project Board refresh failed. $message',
        child: Column(
          children: <Widget>[
            Icon(
              Icons.cloud_off_outlined,
              size: 64,
              semanticLabel: 'Mobile Project Board refresh failed',
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 24),
            Text(
              'Couldn’t refresh the Board',
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: onRefresh,
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    ),
  );
}

String _loadingLabel(
  List<ProjectCatalogItem> projects,
  String? selectedProjectId,
) {
  final selected = projects.where(
    (project) => project.projectId == selectedProjectId,
  );
  return selected.isEmpty
      ? 'Loading Mobile Project Board'
      : 'Loading Mobile Project Board for ${selected.first.name}';
}

List<ProjectBoardTask> _tasksFor(ProjectBoard board, ProjectBoardLane lane) =>
    switch (lane) {
      ProjectBoardLane.focus => board.lanes.focus,
      ProjectBoardLane.inFlight => board.lanes.inFlight,
      ProjectBoardLane.outOfFocus => board.lanes.outOfFocus,
      ProjectBoardLane.backlog => board.lanes.backlog,
    };

const _compactStateLabels = <String, String>{
  'backlog': 'Backlog',
  'idle': 'Idle',
  'active': 'Active',
  'needs-input': 'Needs Input',
  'paused': 'Paused',
  'agent-done': 'Done',
  'failed': 'Failed',
  'interrupted': 'Stopped',
  'done': 'Done',
  'pr-draft': 'PR Draft',
  'pr-open': 'PR Open',
  'ci-running': 'CI Running',
  'review-pending': 'Review Pending',
  'ci-failed': 'CI Failed',
  'changes-requested': 'Changes Req.',
  'unaddressed-comments': 'Unaddressed Comments',
  'ready-to-merge': 'Ready to Merge',
  'ready-to-enqueue': 'Ready to Enqueue',
  'pr-queued': 'Queued',
  'pr-merged': 'Merged',
  'pr-closed': 'Closed',
  'merge-conflict': 'Merge Conflict',
};

String _stateLabel(String state) =>
    _compactStateLabels[state] ??
    state
        .split('-')
        .where((part) => part.isNotEmpty)
        .join(' ')
        .replaceFirstMapped(RegExp(r'^.'), (match) => match[0]!.toUpperCase());

String _pluralize(int count, String singular, [String? plural]) =>
    '$count ${count == 1 ? singular : plural ?? '${singular}s'}';

String _truncateTaskTitle(String title) =>
    title.length > 80 ? '${title.substring(0, 80)}...' : title;

String _relativeActivity(DateTime activityAt, DateTime now) {
  final elapsed = now.difference(activityAt);
  if (elapsed.isNegative || elapsed.inMinutes < 1) return 'just now';
  if (elapsed.inHours < 1) return '${elapsed.inMinutes}m ago';
  if (elapsed.inDays < 1) return '${elapsed.inHours}h ago';
  return '${elapsed.inDays}d ago';
}

String _taskSemanticsLabel(
  BuildContext context,
  ProjectBoardTask task,
  String state,
  String relativeActivity,
) {
  final details = <String>[
    'Task ${task.taskId}',
    task.title,
    state,
    task.reason,
    if (task.dependencyCount > 0)
      _pluralize(task.dependencyCount, 'dependency', 'dependencies'),
    if (task.lane == ProjectBoardLane.backlog && task.labels.isNotEmpty)
      '${_pluralize(task.labels.length, 'label')}: ${task.labels.join(', ')}',
    if (task.pullRequestCount > 0)
      _pluralize(task.pullRequestCount, 'pull request'),
    if (task.primaryPullRequestNumber case final number?)
      'primary pull request $number',
    'last activity ${_activityLabel(context, task.activityAt)} ($relativeActivity)',
  ];
  return details.join(', ');
}

String _activityLabel(BuildContext context, DateTime activityAt) {
  final local = activityAt.toLocal();
  final localizations = MaterialLocalizations.of(context);
  final date = localizations.formatMediumDate(local);
  final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(local));
  return '$date · $time';
}
