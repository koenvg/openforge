import 'package:flutter/material.dart';

import '../generated/companion_v1_client.dart';
import 'project_board_controller.dart';

part 'project_board_content.dart';

class ProjectBoardHome extends StatefulWidget {
  const ProjectBoardHome({
    required this.controller,
    this.onTaskSelected,
    super.key,
  });

  final ProjectBoardController controller;
  final ValueChanged<String>? onTaskSelected;

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
          IconButton(
            onPressed: widget.controller.refresh,
            tooltip: 'Refresh Mobile Project Board',
            icon: const Icon(Icons.refresh),
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
      body: SafeArea(
        child: _ProjectBoardBody(
          state: state,
          lane: widget.controller.selectedLane,
          scrollController: _scrollControllers[widget.controller.selectedLane]!,
          onRefresh: widget.controller.refresh,
          onTaskSelected: widget.onTaskSelected,
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
