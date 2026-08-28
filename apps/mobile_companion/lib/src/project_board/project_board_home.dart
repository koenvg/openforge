import 'package:flutter/material.dart';

import '../action_palette/action_palette.dart';
import '../action_palette/action_palette_controller.dart';
import '../generated/companion_v1_client.dart';
import 'project_board_controller.dart';
import 'project_board_task_card.dart';
import 'task_creation_sheet.dart';

part 'project_board_content.dart';

class ProjectBoardHome extends StatefulWidget {
  const ProjectBoardHome({
    required this.controller,
    this.onTaskSelected,
    this.actionPaletteController,
    super.key,
  });

  final ProjectBoardController controller;
  final ValueChanged<String>? onTaskSelected;
  final MobileActionPaletteController? actionPaletteController;

  @override
  State<ProjectBoardHome> createState() => _ProjectBoardHomeState();
}

class _ProjectBoardHomeState extends State<ProjectBoardHome>
    with SingleTickerProviderStateMixin {
  late final TabController _tabs;
  late final Map<ProjectBoardLane, ScrollController> _scrollControllers;
  String? _visibleProjectId;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(
      length: ProjectBoardLane.values.length,
      initialIndex: widget.controller.selectedLane.index,
      vsync: this,
    );
    _scrollControllers = <ProjectBoardLane, ScrollController>{
      for (final lane in ProjectBoardLane.values)
        lane: _createScrollController(lane),
    };
    _visibleProjectId = widget.controller.selectedProjectId;
    widget.controller.addListener(_onControllerChanged);
  }

  @override
  void didUpdateWidget(covariant ProjectBoardHome oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.controller == widget.controller) return;
    oldWidget.controller.removeListener(_onControllerChanged);
    widget.controller.addListener(_onControllerChanged);
    _visibleProjectId = widget.controller.selectedProjectId;
    _syncSelectedLane();
    _resetScrollControllers();
  }

  @override
  void dispose() {
    widget.controller.removeListener(_onControllerChanged);
    _tabs.dispose();
    for (final controller in _scrollControllers.values) {
      controller.dispose();
    }
    super.dispose();
  }

  ScrollController _createScrollController(ProjectBoardLane lane) {
    final controller = ScrollController(
      initialScrollOffset: widget.controller.scrollOffsetFor(lane),
    );
    controller.addListener(() {
      widget.controller.rememberScrollOffset(lane, controller.offset);
    });
    return controller;
  }

  void _onControllerChanged() {
    final selectedProjectId = widget.controller.selectedProjectId;
    if (selectedProjectId != _visibleProjectId) {
      _visibleProjectId = selectedProjectId;
      _resetScrollControllers();
    }
    _syncSelectedLane();
    if (mounted) setState(() {});
  }

  void _syncSelectedLane() {
    final index = widget.controller.selectedLane.index;
    if (_tabs.index != index) _tabs.index = index;
  }

  void _resetScrollControllers() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      for (final entry in _scrollControllers.entries) {
        final controller = entry.value;
        if (controller.hasClients) {
          controller.jumpTo(widget.controller.scrollOffsetFor(entry.key));
        }
      }
    });
  }

  Future<void> _showTaskComposer() async {
    final state = widget.controller.state;
    if (state is! ProjectBoardLoaded) return;
    final created = await showModalBottomSheet<TaskCreateResult>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      showDragHandle: true,
      builder: (context) => TaskCreationSheet(
        projectName: state.board.projectName,
        loadPromptCatalog: widget.controller.fetchTaskPromptCatalog,
        onCreate: widget.controller.createTask,
      ),
    );
    if (!mounted || created == null) return;
    widget.onTaskSelected?.call(created.taskId);
  }

  Future<MobilePaletteAction?> _showPalette({
    required String title,
    required Future<List<MobilePaletteAction>> actions,
    String? taskTitle,
  }) => showMobileActionPalette(
    context: context,
    title: title,
    actions: actions,
    onConfirm: (action) => _confirmPaletteAction(action, taskTitle),
  );

  Future<bool> _confirmPaletteAction(
    MobilePaletteAction action,
    String? taskTitle,
  ) async {
    if (!action.requiresConfirmation) return true;
    final message = mobileActionPaletteConfirmationMessage(
      action,
      taskTitle: taskTitle,
      inlineTaskQuestion: true,
    );
    return await showDialog<bool>(
          context: context,
          builder: (dialogContext) => AlertDialog(
            title: Text(action.label),
            content: Text(message),
            actions: <Widget>[
              TextButton(
                onPressed: () => Navigator.of(dialogContext).pop(false),
                child: const Text('Cancel'),
              ),
              FilledButton(
                onPressed: () => Navigator.of(dialogContext).pop(true),
                child: Text(action.label),
              ),
            ],
          ),
        ) ??
        false;
  }

  Future<void> _showGeneralActions() async {
    final palette = widget.actionPaletteController;
    final projectId = widget.controller.selectedProjectId;
    if (palette == null || projectId == null) return;
    final action = await _showPalette(
      title: 'Actions',
      actions: (() async => <MobilePaletteAction>[
        MobileNativePaletteActions.newTask,
        MobileNativePaletteActions.refreshBoard,
        ...await palette.loadProjectActions(projectId),
      ])(),
    );
    if (!mounted || action == null) return;
    try {
      switch (action.id) {
        case CompanionActionId.newTask:
          await _showTaskComposer();
        case CompanionActionId.refreshBoard:
          await widget.controller.refresh();
        case CompanionActionId.refreshGithub:
          await palette.refreshGithub();
        default:
          return;
      }
      if (mounted && action.id != CompanionActionId.newTask) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('${action.label} completed.')));
      }
    } on CompanionV1Exception catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text(error.message)));
      }
    } on Object {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('${action.label} failed. Refresh and try again.'),
          ),
        );
      }
    }
  }

  Future<void> _showTaskActions(ProjectBoardTask task) async {
    final palette = widget.actionPaletteController;
    if (palette == null) return;
    final action = await _showPalette(
      title: 'Task actions',
      taskTitle: task.title,
      actions: palette.loadTaskActions(task.taskId),
    );
    if (!mounted || action == null) return;
    try {
      await palette.executeTaskAction(
        task.taskId,
        action.id,
        mergeMethod: action.selectedMergeMethod,
      );
      if (mounted) {
        ScaffoldMessenger.of(
          context,
        ).showSnackBar(SnackBar(content: Text('${action.label} completed.')));
      }
    } on Object catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              mobileActionFailureMessage(
                error,
                fallback: '${action.label} failed. Task state was refreshed.',
              ),
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = widget.controller.state;
    return Scaffold(
      appBar: AppBar(
        title: _ProjectSelector(
          state: state,
          onSelected: widget.controller.selectProject,
        ),
        actions: <Widget>[
          if (state is ProjectBoardLoaded &&
              widget.actionPaletteController != null)
            IconButton(
              onPressed: _showGeneralActions,
              tooltip: 'Actions',
              icon: const Icon(Icons.more_vert_rounded),
            ),
        ],
        bottom: state is ProjectBoardLoaded
            ? _BoardTabs(
                controller: _tabs,
                board: state.board,
                onSelected: (index) => widget.controller.selectLane(
                  ProjectBoardLane.values[index],
                ),
              )
            : null,
      ),
      floatingActionButton: state is ProjectBoardLoaded
          ? Semantics(
              label: 'Create new Task',
              button: true,
              child: ExcludeSemantics(
                child: FloatingActionButton.extended(
                  onPressed: _showTaskComposer,
                  tooltip: 'Create new Task',
                  icon: const Icon(Icons.add_task),
                  label: const Text('New Task'),
                ),
              ),
            )
          : null,
      body: SafeArea(
        child: _ProjectBoardBody(
          state: state,
          lane: widget.controller.selectedLane,
          scrollController: _scrollControllers[widget.controller.selectedLane]!,
          onRefresh: widget.controller.refresh,
          onTaskSelected: widget.onTaskSelected,
          onTaskActions: widget.actionPaletteController == null
              ? null
              : _showTaskActions,
        ),
      ),
    );
  }
}

class _ProjectSelector extends StatelessWidget {
  const _ProjectSelector({required this.state, required this.onSelected});

  final ProjectBoardViewState state;
  final ValueChanged<String> onSelected;

  @override
  Widget build(BuildContext context) {
    final (projects, selectedProjectId) = switch (state) {
      ProjectBoardLoading(:final projects, :final selectedProjectId) => (
        projects,
        selectedProjectId,
      ),
      ProjectBoardLoaded(:final projects, :final selectedProjectId) => (
        projects,
        selectedProjectId,
      ),
      ProjectBoardLoadError(:final projects, :final selectedProjectId) => (
        projects,
        selectedProjectId,
      ),
      ProjectBoardNoProjects() => (const <ProjectCatalogItem>[], null),
    };
    final selectedProject = projects.where(
      (project) => project.projectId == selectedProjectId,
    );
    if (selectedProject.isEmpty) {
      return const Text('Mobile Project Board');
    }
    final selectedName = selectedProject.first.name;
    return Semantics(
      label: 'Selected Project, $selectedName',
      button: true,
      child: PopupMenuButton<String>(
        tooltip: 'Selected Project, $selectedName',
        onSelected: onSelected,
        itemBuilder: (context) => projects
            .map(
              (project) => PopupMenuItem<String>(
                value: project.projectId,
                child: Text(project.name),
              ),
            )
            .toList(growable: false),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Flexible(
              child: Text(
                selectedName,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
            const Icon(Icons.arrow_drop_down),
          ],
        ),
      ),
    );
  }
}

class _BoardTabs extends StatelessWidget implements PreferredSizeWidget {
  const _BoardTabs({
    required this.controller,
    required this.board,
    required this.onSelected,
  });

  final TabController controller;
  final ProjectBoard board;
  final ValueChanged<int> onSelected;

  @override
  Size get preferredSize => const Size.fromHeight(kTextTabBarHeight);

  @override
  Widget build(BuildContext context) => TabBar(
    controller: controller,
    isScrollable: true,
    tabAlignment: TabAlignment.start,
    onTap: onSelected,
    tabs: <Widget>[
      Tab(text: 'Focus ${board.counts.focus}'),
      Tab(text: 'In Flight ${board.counts.inFlight}'),
      Tab(text: 'Out of Focus ${board.counts.outOfFocus}'),
      Tab(text: 'Backlog ${board.counts.backlog}'),
    ],
  );
}
