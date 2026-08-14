import 'package:flutter/foundation.dart';

import 'action_palette_models.dart';

final class MobileActionPalettePresentationModel extends ChangeNotifier {
  factory MobileActionPalettePresentationModel({
    required List<MobilePaletteAction> actions,
    required PaletteActionExecutor onExecute,
    PaletteActionConfirmer? onConfirm,
  }) => MobileActionPalettePresentationModel._(actions, onExecute, onConfirm);

  MobileActionPalettePresentationModel._(
    this._actions,
    this._onExecute,
    this._onConfirm,
  );

  List<MobilePaletteAction> _actions;
  PaletteActionExecutor _onExecute;
  PaletteActionConfirmer? _onConfirm;
  String _query = '';
  CompanionActionId? _pendingActionId;
  var _disposed = false;

  CompanionActionId? get pendingActionId => _pendingActionId;

  List<MobilePaletteAction> get filteredActions {
    final query = _query.trim().toLowerCase();
    if (query.isEmpty) return _actions;
    return _actions
        .where(
          (action) =>
              action.label.toLowerCase().contains(query) ||
              action.keywords.any((keyword) => keyword.contains(query)),
        )
        .toList(growable: false);
  }

  void updateQuery(String value) {
    if (_query == value) return;
    _query = value;
    notifyListeners();
  }

  void updateConfiguration({
    required List<MobilePaletteAction> actions,
    required PaletteActionExecutor onExecute,
    required PaletteActionConfirmer? onConfirm,
  }) {
    _actions = actions;
    _onExecute = onExecute;
    _onConfirm = onConfirm;
    notifyListeners();
  }

  Future<void> execute(MobilePaletteAction action) async {
    if (_pendingActionId != null) return;
    final confirm = _onConfirm;
    if (action.requiresConfirmation &&
        (confirm == null || !await confirm(action))) {
      return;
    }
    if (_disposed) return;

    _pendingActionId = action.id;
    notifyListeners();
    try {
      await _onExecute(action);
    } finally {
      if (!_disposed) {
        _pendingActionId = null;
        notifyListeners();
      }
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
