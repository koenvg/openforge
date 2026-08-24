import 'package:flutter/material.dart';

import 'action_palette_models.dart';
import 'action_palette_presentation_model.dart';

Future<MobilePaletteAction?> showMobileActionPalette({
  required BuildContext context,
  required String title,
  required Future<List<MobilePaletteAction>> actions,
  PaletteActionConfirmer? onConfirm,
}) => showModalBottomSheet<MobilePaletteAction>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  showDragHandle: true,
  builder: (sheetContext) => FractionallySizedBox(
    heightFactor: 0.72,
    child: FutureBuilder<List<MobilePaletteAction>>(
      future: actions,
      builder: (context, snapshot) {
        if (snapshot.hasError) {
          return const Center(
            child: Text('Actions are temporarily unavailable.'),
          );
        }
        final loaded = snapshot.data;
        if (loaded == null) {
          return const Center(child: CircularProgressIndicator());
        }
        return MobileActionPalette(
          title: title,
          actions: loaded,
          onConfirm: onConfirm,
          onExecute: (action) async => Navigator.of(sheetContext).pop(action),
        );
      },
    ),
  ),
);

class MobileActionPalette extends StatefulWidget {
  const MobileActionPalette({
    required this.title,
    required this.actions,
    required this.onExecute,
    this.onConfirm,
    super.key,
  });

  final String title;
  final List<MobilePaletteAction> actions;
  final PaletteActionExecutor onExecute;
  final PaletteActionConfirmer? onConfirm;

  @override
  State<MobileActionPalette> createState() => _MobileActionPaletteState();
}

class _MobileActionPaletteState extends State<MobileActionPalette> {
  late final MobileActionPalettePresentationModel _model;
  MobilePaletteAction? _mergeAction;
  MobileMergeMethod? _selectedMergeMethod;

  @override
  void initState() {
    super.initState();
    _model = MobileActionPalettePresentationModel(
      actions: widget.actions,
      onExecute: widget.onExecute,
      onConfirm: widget.onConfirm,
    )..addListener(_handleModelChanged);
  }

  @override
  void didUpdateWidget(MobileActionPalette oldWidget) {
    super.didUpdateWidget(oldWidget);
    _model.updateConfiguration(
      actions: widget.actions,
      onExecute: widget.onExecute,
      onConfirm: widget.onConfirm,
    );
  }

  @override
  void dispose() {
    _model
      ..removeListener(_handleModelChanged)
      ..dispose();
    super.dispose();
  }

  void _handleModelChanged() {
    if (mounted) setState(() {});
  }

  String _mergeMethodLabel(MobileMergeMethod method) => switch (method) {
    MobileMergeMethod.merge => 'Create a merge commit',
    MobileMergeMethod.squash => 'Squash and merge',
    MobileMergeMethod.rebase => 'Rebase and merge',
  };

  void _selectAction(MobilePaletteAction action) {
    if (action.mergeMethods.isNotEmpty) {
      setState(() {
        _mergeAction = action;
        _selectedMergeMethod =
            action.defaultMergeMethod ?? action.mergeMethods.first;
      });
      return;
    }
    _model.execute(action);
  }

  Future<void> _confirmMerge() async {
    final action = _mergeAction;
    final mergeMethod = _selectedMergeMethod;
    if (action == null || mergeMethod == null) return;
    await _model.execute(action.withSelectedMergeMethod(mergeMethod));
    if (mounted) {
      setState(() {
        _mergeAction = null;
        _selectedMergeMethod = null;
      });
    }
  }

  void _cancelMerge() {
    setState(() {
      _mergeAction = null;
      _selectedMergeMethod = null;
    });
  }

  @override
  Widget build(BuildContext context) {
    final actions = _model.filteredActions;
    final mergeAction = _mergeAction;
    if (mergeAction != null) {
      final selectedMergeMethod = _selectedMergeMethod;
      return SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: <Widget>[
              Text(
                'Choose merge method',
                style: Theme.of(context).textTheme.titleLarge,
              ),
              const SizedBox(height: 4),
              Text(
                mergeAction.label,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              RadioGroup<MobileMergeMethod>(
                groupValue: selectedMergeMethod,
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _selectedMergeMethod = value);
                  }
                },
                child: Column(
                  children: <Widget>[
                    for (final mergeMethod in mergeAction.mergeMethods)
                      RadioListTile<MobileMergeMethod>(
                        value: mergeMethod,
                        title: Text(_mergeMethodLabel(mergeMethod)),
                        subtitle: mergeMethod == mergeAction.defaultMergeMethod
                            ? const Text('GitHub default')
                            : null,
                      ),
                  ],
                ),
              ),
              const SizedBox(height: 12),
              Row(
                mainAxisAlignment: MainAxisAlignment.end,
                children: <Widget>[
                  TextButton(
                    onPressed: _cancelMerge,
                    child: const Text('Cancel'),
                  ),
                  const SizedBox(width: 8),
                  FilledButton(
                    onPressed: selectedMergeMethod == null
                        ? null
                        : _confirmMerge,
                    child: Text(
                      selectedMergeMethod == null
                          ? 'Confirm merge'
                          : 'Confirm ${_mergeMethodLabel(selectedMergeMethod).toLowerCase()}',
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      );
    }

    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: <Widget>[
            Text(widget.title, style: Theme.of(context).textTheme.titleLarge),
            const SizedBox(height: 12),
            TextField(
              onChanged: _model.updateQuery,
              decoration: const InputDecoration(
                labelText: 'Filter actions',
                prefixIcon: Icon(Icons.search_rounded),
                border: OutlineInputBorder(),
              ),
            ),
            const SizedBox(height: 8),
            if (actions.isEmpty)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Text('No matching actions', textAlign: TextAlign.center),
              )
            else
              Flexible(
                child: ListView.builder(
                  shrinkWrap: true,
                  itemCount: actions.length,
                  itemBuilder: (context, index) {
                    final action = actions[index];
                    final pending = _model.pendingActionId == action.id;
                    final color = action.destructive
                        ? Theme.of(context).colorScheme.error
                        : null;
                    return ListTile(
                      minTileHeight: 48,
                      leading: pending
                          ? const SizedBox.square(
                              dimension: 24,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Icon(action.icon, color: color),
                      title: Text(action.label, style: TextStyle(color: color)),
                      enabled: _model.pendingActionId == null,
                      onTap: () => _selectAction(action),
                    );
                  },
                ),
              ),
          ],
        ),
      ),
    );
  }
}
