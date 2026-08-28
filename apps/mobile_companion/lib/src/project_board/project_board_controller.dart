import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../client/companion_refresh_outcome.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';

sealed class ProjectBoardViewState {
  const ProjectBoardViewState();
}

final class ProjectBoardLoading extends ProjectBoardViewState {
  ProjectBoardLoading({
    List<ProjectCatalogItem> projects = const <ProjectCatalogItem>[],
    this.selectedProjectId,
  }) : projects = List<ProjectCatalogItem>.unmodifiable(projects);

  final List<ProjectCatalogItem> projects;
  final String? selectedProjectId;
}

final class ProjectBoardNoProjects extends ProjectBoardViewState {
  const ProjectBoardNoProjects();
}

final class ProjectBoardLoaded extends ProjectBoardViewState {
  ProjectBoardLoaded({
    required List<ProjectCatalogItem> projects,
    required this.selectedProjectId,
    required this.board,
  }) : projects = List<ProjectCatalogItem>.unmodifiable(projects);

  final List<ProjectCatalogItem> projects;
  final String selectedProjectId;
  final ProjectBoard board;
}

final class ProjectBoardLoadError extends ProjectBoardViewState {
  ProjectBoardLoadError({
    required this.message,
    List<ProjectCatalogItem> projects = const <ProjectCatalogItem>[],
    this.selectedProjectId,
  }) : projects = List<ProjectCatalogItem>.unmodifiable(projects);

  final String message;
  final List<ProjectCatalogItem> projects;
  final String? selectedProjectId;
}

final class TaskCreationFailure implements Exception {
  const TaskCreationFailure({
    required this.message,
    required this.outcomeMayBeUncertain,
  });

  final String message;
  final bool outcomeMayBeUncertain;

  @override
  String toString() => message;
}

final class ProjectBoardController extends ChangeNotifier {
  ProjectBoardController({
    required this._client,
    required this._storage,
    this._onAuthorizationLost,
  });

  final CompanionClient _client;
  final CompanionProjectStorage _storage;
  final VoidCallback? _onAuthorizationLost;

  int _generation = 0;
  Future<void> _selectionWrites = Future<void>.value();
  List<ProjectCatalogItem> _projects = const <ProjectCatalogItem>[];
  String? _selectedProjectId;
  ProjectBoardLane _selectedLane = ProjectBoardLane.focus;
  final Map<ProjectBoardLane, double> _scrollOffsets =
      <ProjectBoardLane, double>{};

  ProjectBoardViewState _state = ProjectBoardLoading();
  ProjectBoardViewState get state => _state;
  String? get selectedProjectId => _selectedProjectId;
  ProjectBoardLane get selectedLane => _selectedLane;

  bool isSelectedProject(String projectId) => projectId == _selectedProjectId;

  double scrollOffsetFor(ProjectBoardLane lane) => _scrollOffsets[lane] ?? 0;

  void rememberScrollOffset(ProjectBoardLane lane, double offset) {
    _scrollOffsets[lane] = offset < 0 ? 0 : offset;
  }

  void selectLane(ProjectBoardLane lane) {
    if (_selectedLane == lane) return;
    _selectedLane = lane;
    notifyListeners();
  }

  Future<TaskPromptCatalog> fetchTaskPromptCatalog() async {
    final projectId = _selectedProjectId;
    if (projectId == null) {
      throw StateError('No Project is selected.');
    }
    final trustRecord = await _storage.load();
    if (trustRecord == null) {
      _authorizationLost();
      throw StateError('Companion authorization is unavailable.');
    }

    try {
      return await _client.fetchTaskPromptCatalog(trustRecord, projectId);
    } on CompanionV1Exception catch (error) {
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _authorizationLost();
      }
      rethrow;
    }
  }

  Future<TaskCreateResult> createTask(String initialPrompt) async {
    final prompt = initialPrompt.trim();
    if (prompt.isEmpty) {
      throw ArgumentError.value(
        initialPrompt,
        'initialPrompt',
        'must not be empty',
      );
    }
    final projectId = _selectedProjectId;
    if (projectId == null) {
      throw StateError('No Project is selected.');
    }
    final trustRecord = await _storage.load();
    if (trustRecord == null) {
      _authorizationLost();
      throw StateError('Companion authorization is unavailable.');
    }

    try {
      final created = await _client.createTask(trustRecord, projectId, prompt);
      selectLane(ProjectBoardLane.backlog);
      await refreshSelectedBoardWithOutcome();
      return created;
    } on CompanionV1Exception catch (error) {
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _authorizationLost();
      }
      throw TaskCreationFailure(
        message: error.message,
        outcomeMayBeUncertain: false,
      );
    } on Object {
      selectLane(ProjectBoardLane.backlog);
      await refreshSelectedBoardWithOutcome();
      throw const TaskCreationFailure(
        message: 'Task may have been created. Check Backlog before retrying.',
        outcomeMayBeUncertain: true,
      );
    }
  }

  Future<void> refresh() async {
    await refreshWithOutcome();
  }

  Future<CompanionRefreshOutcome> refreshWithOutcome() async {
    final generation = ++_generation;
    final previousSelectedProjectId = _selectedProjectId;
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      if (trustRecord == null) return _authorizationLost();

      final catalog = await _client.fetchProjectCatalog(trustRecord);
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      final projects = List<ProjectCatalogItem>.unmodifiable(catalog.projects);
      if (projects.isEmpty) {
        await _clearSelectedProject(trustRecord.hostId);
        if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
        _projects = projects;
        _selectedProjectId = null;
        _selectedLane = ProjectBoardLane.focus;
        _scrollOffsets.clear();
        _setState(const ProjectBoardNoProjects());
        return CompanionRefreshOutcome.loaded;
      }

      final persisted = await _loadSelectedProject(trustRecord.hostId);
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      final selected = projects.any((project) => project.projectId == persisted)
          ? persisted!
          : projects.first.projectId;
      if (selected != persisted) {
        await _saveSelectedProject(trustRecord.hostId, selected);
        if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      }
      return await _loadBoard(
        generation,
        trustRecord,
        selected,
        projects: projects,
        resetLaneContext:
            previousSelectedProjectId != null &&
            previousSelectedProjectId != selected,
      );
    } on CompanionV1Exception catch (error) {
      return _handleCompanionError(generation, error);
    } on Object {
      return _handleUnavailable(generation);
    }
  }

  Future<void> selectProject(String projectId) async {
    if (projectId == _selectedProjectId ||
        !_projects.any((project) => project.projectId == projectId)) {
      return;
    }
    final generation = ++_generation;
    _selectedProjectId = projectId;
    _selectedLane = ProjectBoardLane.focus;
    _scrollOffsets.clear();
    _setState(
      ProjectBoardLoading(projects: _projects, selectedProjectId: projectId),
    );
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return;
      if (trustRecord == null) {
        _authorizationLost();
        return;
      }
      await _saveSelectedProject(trustRecord.hostId, projectId);
      if (!_isCurrent(generation)) return;
      await _loadBoard(generation, trustRecord, projectId);
    } on CompanionV1Exception catch (error) {
      _handleCompanionError(generation, error);
    } on Object {
      _handleUnavailable(generation);
    }
  }

  Future<CompanionRefreshOutcome> refreshSelectedBoardWithOutcome() async {
    final selected = _selectedProjectId;
    if (selected == null || _projects.isEmpty) return refreshWithOutcome();
    final generation = ++_generation;
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
      if (trustRecord == null) return _authorizationLost();
      return await _loadBoard(generation, trustRecord, selected);
    } on CompanionV1Exception catch (error) {
      return _handleCompanionError(generation, error);
    } on Object {
      return _handleUnavailable(generation);
    }
  }

  Future<CompanionRefreshOutcome> _loadBoard(
    int generation,
    CompanionTrustRecord trustRecord,
    String selected, {
    List<ProjectCatalogItem>? projects,
    bool resetLaneContext = false,
  }) async {
    final board = await _client.fetchProjectBoard(trustRecord, selected);
    if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
    if (board.projectId != selected) {
      throw const FormatException(
        'Project Board response did not match the Selected Project.',
      );
    }
    if (projects != null) _projects = projects;
    if (resetLaneContext) {
      _selectedLane = ProjectBoardLane.focus;
      _scrollOffsets.clear();
    }
    _selectedProjectId = selected;
    _setState(
      ProjectBoardLoaded(
        projects: _projects,
        selectedProjectId: selected,
        board: board,
      ),
    );
    return CompanionRefreshOutcome.loaded;
  }

  Future<String?> _loadSelectedProject(String hostId) async {
    await _selectionWrites;
    return _storage.loadSelectedProject(hostId);
  }

  Future<void> _saveSelectedProject(String hostId, String projectId) =>
      _enqueueSelectionWrite(
        () => _storage.saveSelectedProject(hostId, projectId),
      );

  Future<void> _clearSelectedProject(String hostId) =>
      _enqueueSelectionWrite(() => _storage.clearSelectedProject(hostId));

  Future<void> _enqueueSelectionWrite(Future<void> Function() write) {
    final result = _selectionWrites.then((_) => write());
    _selectionWrites = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return result;
  }

  void clear() {
    _generation += 1;
    _projects = const <ProjectCatalogItem>[];
    _selectedProjectId = null;
    _selectedLane = ProjectBoardLane.focus;
    _scrollOffsets.clear();
    _setState(ProjectBoardLoading());
  }

  CompanionRefreshOutcome _handleCompanionError(
    int generation,
    CompanionV1Exception error,
  ) {
    if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
    if (error.code == 'revoked' || error.code == 'unauthenticated') {
      return _authorizationLost();
    }
    _setLoadError();
    return error.code == 'incompatible_version'
        ? CompanionRefreshOutcome.incompatible
        : CompanionRefreshOutcome.unavailable;
  }

  CompanionRefreshOutcome _handleUnavailable(int generation) {
    if (!_isCurrent(generation)) return CompanionRefreshOutcome.superseded;
    _setLoadError();
    return CompanionRefreshOutcome.unavailable;
  }

  CompanionRefreshOutcome _authorizationLost() {
    _projects = const <ProjectCatalogItem>[];
    _selectedProjectId = null;
    _selectedLane = ProjectBoardLane.focus;
    _scrollOffsets.clear();
    _setState(
      ProjectBoardLoadError(
        message: 'Pair this phone again to load the Mobile Project Board.',
      ),
    );
    _onAuthorizationLost?.call();
    return CompanionRefreshOutcome.authorizationRequired;
  }

  void _setLoadError() {
    _setState(
      ProjectBoardLoadError(
        message:
            'The Mobile Project Board could not be loaded. Check the desktop connection and try again.',
        projects: _projects,
        selectedProjectId: _selectedProjectId,
      ),
    );
  }

  bool _isCurrent(int generation) => generation == _generation;

  void _setState(ProjectBoardViewState state) {
    _state = state;
    notifyListeners();
  }
}
