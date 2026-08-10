part of 'task_detail_screen.dart';

final class _TaskLabelsCard extends StatelessWidget {
  const _TaskLabelsCard({required this.labels});

  final List<String> labels;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Labels. ${labels.join(', ')}.',
    child: ExcludeSemantics(
      child: _DetailCard(
        children: <Widget>[
          Text('Labels', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: <Widget>[
              for (final label in labels) Chip(label: Text(label)),
            ],
          ),
        ],
      ),
    ),
  );
}

enum _TaskRelationshipKind { dependency, dependent }

final class _TaskRelationshipItem {
  const _TaskRelationshipItem({
    required this.taskId,
    required this.title,
    required this.boardStatus,
    required this.readiness,
  });

  final String taskId;
  final String title;
  final String boardStatus;
  final String? readiness;
}

final class _TaskRelationshipsCard extends StatelessWidget {
  _TaskRelationshipsCard.dependencies({
    required List<TaskRelationship> relationships,
    required this.onOpenTask,
  }) : title = 'Dependencies',
       kind = _TaskRelationshipKind.dependency,
       items = <_TaskRelationshipItem>[
         for (final relationship in relationships)
           _TaskRelationshipItem(
             taskId: relationship.taskId,
             title: relationship.title,
             boardStatus: relationship.boardStatus,
             readiness: null,
           ),
       ];

  _TaskRelationshipsCard.dependents({
    required List<DependentTask> relationships,
    required this.onOpenTask,
  }) : title = 'Dependent tasks',
       kind = _TaskRelationshipKind.dependent,
       items = <_TaskRelationshipItem>[
         for (final relationship in relationships)
           _TaskRelationshipItem(
             taskId: relationship.taskId,
             title: relationship.title,
             boardStatus: relationship.boardStatus,
             readiness: relationship.remainingDependencyCount == 0
                 ? 'Ready after this'
                 : 'Still waits on ${relationship.remainingDependencyCount} '
                       '${relationship.remainingDependencyCount == 1 ? 'dependency' : 'dependencies'}',
           ),
       ];

  final String title;
  final _TaskRelationshipKind kind;
  final List<_TaskRelationshipItem> items;
  final void Function(String taskId)? onOpenTask;

  @override
  Widget build(BuildContext context) {
    final footer = switch (kind) {
      _TaskRelationshipKind.dependency => _dependencyFooter(),
      _TaskRelationshipKind.dependent =>
        '${items.length} ${items.length == 1 ? 'task depends' : 'tasks depend'} on this one',
    };

    return _DetailCard(
      children: <Widget>[
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 4),
        for (var index = 0; index < items.length; index++) ...<Widget>[
          if (index > 0) const Divider(height: 1),
          _TaskRelationshipRow(
            item: items[index],
            kind: kind,
            onOpenTask: onOpenTask,
          ),
        ],
        const SizedBox(height: 4),
        Text(footer, style: Theme.of(context).textTheme.bodySmall),
      ],
    );
  }

  String _dependencyFooter() {
    final waitingCount = items
        .where((item) => item.boardStatus != 'done')
        .length;
    if (waitingCount == 0) return 'All dependencies done';
    return 'Waiting on $waitingCount '
        '${waitingCount == 1 ? 'dependency' : 'dependencies'}';
  }
}

final class _TaskRelationshipRow extends StatelessWidget {
  const _TaskRelationshipRow({
    required this.item,
    required this.kind,
    required this.onOpenTask,
  });

  final _TaskRelationshipItem item;
  final _TaskRelationshipKind kind;
  final void Function(String taskId)? onOpenTask;

  @override
  Widget build(BuildContext context) {
    final status = _boardStatusLabel(item.boardStatus);
    final relationship = switch (kind) {
      _TaskRelationshipKind.dependency => 'Dependency',
      _TaskRelationshipKind.dependent => 'Dependent Task',
    };
    final readiness = item.readiness == null ? '' : ' ${item.readiness}.';

    return Semantics(
      button: onOpenTask != null,
      label:
          '$relationship ${item.taskId}. ${item.title}. Status $status.$readiness',
      child: ExcludeSemantics(
        child: ListTile(
          contentPadding: EdgeInsets.zero,
          minVerticalPadding: 12,
          onTap: onOpenTask == null ? null : () => onOpenTask!(item.taskId),
          title: Text(item.title),
          subtitle: Text(
            item.readiness == null
                ? item.taskId
                : '${item.taskId} · ${item.readiness}',
          ),
          trailing: Chip(label: Text(status)),
        ),
      ),
    );
  }
}
