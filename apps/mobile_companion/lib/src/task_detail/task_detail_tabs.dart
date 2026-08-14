part of 'task_detail_screen.dart';

class _TaskDetailTabs extends StatelessWidget {
  const _TaskDetailTabs({
    required this.controller,
    required this.selectedTab,
    required this.onRefresh,
    required this.onActions,
    required this.details,
    required this.terminalSurface,
    this.bottomAction,
  });

  final TabController controller;
  final int selectedTab;
  final Future<void> Function() onRefresh;
  final VoidCallback? onActions;
  final Widget details;
  final AgentTerminalSurface? terminalSurface;
  final Widget? bottomAction;

  @override
  Widget build(BuildContext context) => Scaffold(
    resizeToAvoidBottomInset: true,
    appBar: AppBar(
      title: const Text('Task'),
      actions: <Widget>[
        IconButton(
          onPressed: () => onRefresh(),
          tooltip: 'Refresh Task detail',
          icon: const Icon(Icons.refresh),
        ),
        if (onActions != null)
          IconButton(
            onPressed: onActions,
            tooltip: 'Task actions',
            icon: const Icon(Icons.more_vert_rounded),
          ),
      ],
      bottom: TabBar(
        controller: controller,
        tabs: const <Widget>[
          Tab(text: 'Details'),
          Tab(text: 'Terminal'),
        ],
      ),
    ),
    bottomNavigationBar: selectedTab == 0 ? bottomAction : null,
    body: SafeArea(
      child: IndexedStack(
        index: selectedTab,
        children: <Widget>[
          details,
          AgentTerminalPane(surface: terminalSurface),
        ],
      ),
    ),
  );
}
