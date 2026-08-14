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

  @override
  Widget build(BuildContext context) {
    final actions = _model.filteredActions;
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
                      onTap: () => _model.execute(action),
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
