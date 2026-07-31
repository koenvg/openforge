import 'package:flutter/material.dart';

import '../generated/companion_v1_client.dart';
import 'attention_controller.dart';

class AttentionHome extends StatelessWidget {
  const AttentionHome({
    required this.state,
    required this.onRefresh,
    super.key,
  });

  final AttentionViewState state;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('Needs Attention'),
      actions: <Widget>[
        IconButton(
          onPressed: () => onRefresh(),
          tooltip: 'Refresh attention',
          icon: const Icon(Icons.refresh),
        ),
      ],
    ),
    body: SafeArea(
      child: _AttentionBody(state: state, onRefresh: onRefresh),
    ),
  );
}

class _AttentionBody extends StatelessWidget {
  const _AttentionBody({required this.state, required this.onRefresh});

  final AttentionViewState state;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => switch (state) {
    AttentionLoading() => Center(
      child: Semantics(
        liveRegion: true,
        label: 'Loading Tasks that need attention',
        child: CircularProgressIndicator(),
      ),
    ),
    AttentionLoadError(:final message) => _AttentionError(
      message: message,
      onRefresh: onRefresh,
    ),
    AttentionLoaded(:final snapshot) when snapshot.items.isEmpty =>
      const _AttentionEmpty(),
    AttentionLoaded(:final snapshot) => _AttentionList(items: snapshot.items),
  };
}

class _AttentionEmpty extends StatelessWidget {
  const _AttentionEmpty();

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Semantics(
        container: true,
        label: "You're all caught up. No Tasks need your attention.",
        child: ExcludeSemantics(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: <Widget>[
              Icon(
                Icons.check_circle_outline,
                size: 64,
                color: Theme.of(context).colorScheme.primary,
              ),
              const SizedBox(height: 24),
              Text(
                "You're all caught up",
                style: Theme.of(context).textTheme.headlineSmall,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                'No Tasks need your attention.',
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

class _AttentionError extends StatelessWidget {
  const _AttentionError({required this.message, required this.onRefresh});

  final String message;
  final Future<void> Function() onRefresh;

  @override
  Widget build(BuildContext context) => Center(
    child: SingleChildScrollView(
      padding: const EdgeInsets.all(32),
      child: Semantics(
        container: true,
        liveRegion: true,
        label: 'Attention refresh failed. $message',
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: <Widget>[
            Icon(
              Icons.cloud_off_outlined,
              size: 64,
              semanticLabel: 'Attention refresh failed',
              color: Theme.of(context).colorScheme.error,
            ),
            const SizedBox(height: 24),
            Text(
              'Couldn’t refresh',
              style: Theme.of(context).textTheme.headlineSmall,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            FilledButton.icon(
              onPressed: () => onRefresh(),
              icon: const Icon(Icons.refresh),
              label: const Text('Try again'),
            ),
          ],
        ),
      ),
    ),
  );
}

class _AttentionList extends StatelessWidget {
  const _AttentionList({required this.items});

  final List<AttentionItem> items;

  @override
  Widget build(BuildContext context) {
    final groups = groupAttentionItems(items);
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      itemCount: groups.length,
      itemBuilder: (context, index) => _ProjectSection(group: groups[index]),
    );
  }
}

class _ProjectSection extends StatelessWidget {
  const _ProjectSection({required this.group});

  final AttentionProjectGroup group;

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label:
        'Project ${group.projectName}, ${group.items.length} attention Tasks',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: <Widget>[
        Padding(
          padding: const EdgeInsets.fromLTRB(8, 20, 8, 8),
          child: Text(
            group.projectName,
            style: Theme.of(context).textTheme.titleLarge,
          ),
        ),
        ...group.items.map((item) => _AttentionRow(item: item)),
      ],
    ),
  );
}

class _AttentionRow extends StatelessWidget {
  const _AttentionRow({required this.item});

  final AttentionItem item;

  @override
  Widget build(BuildContext context) {
    final stateLabel = _stateLabel(item.state);
    final activityLabel = _activityLabel(context, item.activityAt);
    return Semantics(
      container: true,
      label: 'Task ${item.title}, $stateLabel, ${item.reason}, $activityLabel',
      child: ExcludeSemantics(
        child: Card(
          margin: const EdgeInsets.only(bottom: 12),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: <Widget>[
                Text(
                  item.title,
                  style: Theme.of(context).textTheme.titleMedium,
                ),
                const SizedBox(height: 8),
                Text(
                  stateLabel,
                  style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ),
                const SizedBox(height: 4),
                Text(item.reason),
                const SizedBox(height: 12),
                Text(
                  activityLabel,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

String _stateLabel(String state) => switch (state) {
  'needs-input' => 'Needs input',
  'agent-done' => 'Agent done',
  'ci-failed' => 'CI failed',
  'ci-running' => 'CI running',
  'pr-draft' => 'PR draft',
  'pr-open' => 'PR open',
  'pr-queued' => 'PR queued',
  'pr-merged' => 'PR merged',
  'pr-closed' => 'PR closed',
  'review-pending' => 'Review pending',
  'changes-requested' => 'Changes requested',
  'unaddressed-comments' => 'Unaddressed comments',
  'ready-to-merge' => 'Ready to merge',
  'ready-to-enqueue' => 'Ready to enqueue',
  'merge-conflict' => 'Merge conflict',
  _ =>
    state
        .split('-')
        .where((part) => part.isNotEmpty)
        .join(' ')
        .replaceFirstMapped(RegExp(r'^.'), (match) => match[0]!.toUpperCase()),
};

String _activityLabel(BuildContext context, DateTime activityAt) {
  final local = activityAt.toLocal();
  final localizations = MaterialLocalizations.of(context);
  final date = localizations.formatMediumDate(local);
  final time = localizations.formatTimeOfDay(TimeOfDay.fromDateTime(local));
  return '$date · $time';
}
