import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../client/companion_refresh_outcome.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';

sealed class AttentionViewState {
  const AttentionViewState();
}

final class AttentionLoading extends AttentionViewState {
  const AttentionLoading();
}

final class AttentionLoaded extends AttentionViewState {
  const AttentionLoaded(this.snapshot);

  final AttentionSnapshot snapshot;
}

final class AttentionLoadError extends AttentionViewState {
  const AttentionLoadError(this.message);

  final String message;
}

final class AttentionController extends ChangeNotifier {
  factory AttentionController({
    required CompanionClient client,
    required CompanionSecureStorage storage,
    VoidCallback? onAuthorizationLost,
  }) => AttentionController._(client, storage, onAuthorizationLost);

  AttentionController._(this._client, this._storage, this._onAuthorizationLost);

  final CompanionClient _client;
  final CompanionSecureStorage _storage;
  final VoidCallback? _onAuthorizationLost;

  int _generation = 0;

  AttentionViewState _state = const AttentionLoading();
  AttentionViewState get state => _state;

  Future<void> refresh() async {
    await refreshWithOutcome();
  }

  Future<CompanionRefreshOutcome> refreshWithOutcome() async {
    final generation = ++_generation;
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      if (trustRecord == null) {
        _authorizationLost();
        return CompanionRefreshOutcome.authorizationRequired;
      }
      final snapshot = await _client.fetchAttention(trustRecord);
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      _setState(AttentionLoaded(snapshot));
      return CompanionRefreshOutcome.loaded;
    } on CompanionV1Exception catch (error) {
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _authorizationLost();
        return CompanionRefreshOutcome.authorizationRequired;
      }
      _setLoadError();
      return error.code == 'incompatible_version'
          ? CompanionRefreshOutcome.incompatible
          : CompanionRefreshOutcome.unavailable;
    } on Object {
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      _setLoadError();
      return CompanionRefreshOutcome.unavailable;
    }
  }

  void clear() {
    _generation += 1;
    _setState(const AttentionLoading());
  }

  bool _isCurrent(int generation) => generation == _generation;

  void _authorizationLost() {
    _setState(
      const AttentionLoadError(
        'Pair this phone again to load Tasks that need attention.',
      ),
    );
    _onAuthorizationLost?.call();
  }

  void _setLoadError() {
    _setState(
      const AttentionLoadError(
        'Current Task attention could not be loaded. Check the desktop connection and try again.',
      ),
    );
  }

  void _setState(AttentionViewState state) {
    _state = state;
    notifyListeners();
  }
}

final class AttentionProjectGroup {
  AttentionProjectGroup({
    required this.projectId,
    required this.projectName,
    required List<AttentionItem> items,
  }) : items = List<AttentionItem>.unmodifiable(items);

  final String projectId;
  final String projectName;
  final List<AttentionItem> items;
}

List<AttentionProjectGroup> groupAttentionItems(List<AttentionItem> items) {
  final grouped = <String, List<AttentionItem>>{};
  final names = <String, String>{};
  for (final item in items) {
    names[item.projectId] = item.projectName;
    grouped.putIfAbsent(item.projectId, () => <AttentionItem>[]).add(item);
  }
  return grouped.entries
      .map(
        (entry) => AttentionProjectGroup(
          projectId: entry.key,
          projectName: names[entry.key]!,
          items: entry.value,
        ),
      )
      .toList(growable: false);
}
