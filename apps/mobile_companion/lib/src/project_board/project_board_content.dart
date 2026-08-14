part of 'project_board_home.dart';

class _ProjectBoardBody extends StatelessWidget {
  const _ProjectBoardBody({
    required this.state,
    required this.lane,
    required this.scrollController,
    required this.onRefresh,
    required this.onTaskSelected,
    required this.onTaskActions,
  });

  final ProjectBoardViewState state;
  final ProjectBoardLane lane;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;
  final ValueChanged<String>? onTaskSelected;
  final ValueChanged<ProjectBoardTask>? onTaskActions;

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
      onTaskActions: onTaskActions,
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
    required this.onTaskActions,
  });

  final ProjectBoardLane lane;
  final List<ProjectBoardTask> tasks;
  final ScrollController scrollController;
  final Future<void> Function() onRefresh;
  final ValueChanged<String>? onTaskSelected;
  final ValueChanged<ProjectBoardTask>? onTaskActions;

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
              return ProjectBoardTaskCard(
                task: task,
                onTap: onTaskSelected == null
                    ? null
                    : () => onTaskSelected!(task.taskId),
                onActions: onTaskActions == null
                    ? null
                    : () => onTaskActions!(task),
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
