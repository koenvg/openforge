// GENERATED CODE - DO NOT MODIFY BY HAND.
// Source: docs/contracts/companion-v1.openapi.json (OpenAPI 3.1, v1.0.0).

import 'dart:convert';

const companionV1OpenApiSha256 =
    'c9094950ff8546076116c5f50a8337185e2d9089acea9dffe211e46f98de0cd7';
const companionV1ProtocolVersionHeader = 'openforge-companion-protocol-version';
const companionV1ProtocolVersion = '1';

abstract interface class CompanionV1Transport {
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  });
}

final class CompanionV1HttpResponse {
  const CompanionV1HttpResponse({required this.statusCode, required this.body});

  final int statusCode;
  final String body;
}

final class CompanionV1StreamRequest {
  CompanionV1StreamRequest({
    required this.method,
    required this.uri,
    required Map<String, String> headers,
  }) : headers = Map<String, String>.unmodifiable(headers);

  final String method;
  final Uri uri;
  final Map<String, String> headers;
}

final class CompanionV1Exception implements Exception {
  const CompanionV1Exception({
    required this.statusCode,
    required this.code,
    required this.message,
  });

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => 'CompanionV1Exception($statusCode, $code)';
}

final class PairingSubmissionStatus {
  const PairingSubmissionStatus({
    required this.requestId,
    required this.status,
    required this.expiresAt,
  });

  factory PairingSubmissionStatus.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'requestId', 'status', 'expiresAt'});
    final requestId = json.string('requestId');
    final status = json.string('status');
    if (!_isUuid(requestId) || status != 'pending') {
      throw const FormatException('Invalid pairing submission status.');
    }
    return PairingSubmissionStatus(
      requestId: requestId,
      status: status,
      expiresAt: json.dateTime('expiresAt'),
    );
  }

  final String requestId;
  final String status;
  final DateTime expiresAt;
}

final class PairingPoll {
  const PairingPoll({
    required this.status,
    required this.deviceId,
    required this.credential,
  });

  factory PairingPoll.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'status', 'deviceId', 'credential'});
    final status = json.string('status');
    final deviceId = json.nullableString('deviceId');
    final credential = json.nullableString('credential');
    final pending =
        status == 'pending' && deviceId == null && credential == null;
    final approved =
        status == 'approved' &&
        deviceId != null &&
        _isUuid(deviceId) &&
        credential != null &&
        _isCredential(credential);
    if (!pending && !approved) {
      throw const FormatException('Invalid pairing decision.');
    }
    return PairingPoll(
      status: status,
      deviceId: deviceId,
      credential: credential,
    );
  }

  final String status;
  final String? deviceId;
  final String? credential;
}

final class HostStatus {
  const HostStatus({
    required this.hostId,
    required this.protocolVersion,
    required this.serverTime,
  });

  factory HostStatus.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'hostId', 'protocolVersion', 'serverTime'});
    final hostId = json.string('hostId');
    final protocolVersion = json.integer('protocolVersion');
    if (!_isUuid(hostId) || protocolVersion != 1) {
      throw const FormatException('Invalid Companion host status.');
    }
    return HostStatus(
      hostId: hostId,
      protocolVersion: protocolVersion,
      serverTime: json.dateTime('serverTime'),
    );
  }

  final String hostId;
  final int protocolVersion;
  final DateTime serverTime;
}

final class AttentionSnapshot {
  AttentionSnapshot({
    required this.snapshotAt,
    required List<AttentionItem> items,
  }) : items = List<AttentionItem>.unmodifiable(items);

  factory AttentionSnapshot.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'snapshotAt', 'items'});
    final rawItems = json['items'];
    if (rawItems is! List<Object?>) {
      throw const FormatException('Expected an attention item list.');
    }
    return AttentionSnapshot(
      snapshotAt: json.dateTime('snapshotAt'),
      items: rawItems.map((item) {
        if (item is! Map<String, Object?>) {
          throw const FormatException('Expected an attention item object.');
        }
        return AttentionItem.fromJson(item);
      }).toList(),
    );
  }

  final DateTime snapshotAt;
  final List<AttentionItem> items;
}

final class AttentionItem {
  const AttentionItem({
    required this.taskId,
    required this.projectId,
    required this.projectName,
    required this.title,
    required this.state,
    required this.reason,
    required this.activityAt,
  });

  factory AttentionItem.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{
      'taskId',
      'projectId',
      'projectName',
      'title',
      'state',
      'reason',
      'activityAt',
    });
    final taskId = json.string('taskId');
    final projectId = json.string('projectId');
    final projectName = json.string('projectName');
    final title = json.string('title');
    final state = json.string('state');
    final reason = json.string('reason');
    if (<String>[
      taskId,
      projectId,
      projectName,
      title,
      state,
      reason,
    ].any((value) => value.isEmpty)) {
      throw const FormatException('Attention fields must not be empty.');
    }
    return AttentionItem(
      taskId: taskId,
      projectId: projectId,
      projectName: projectName,
      title: title,
      state: state,
      reason: reason,
      activityAt: json.dateTime('activityAt'),
    );
  }

  final String taskId;
  final String projectId;
  final String projectName;
  final String title;
  final String state;
  final String reason;
  final DateTime activityAt;
}

final class ProjectCatalog {
  ProjectCatalog({
    required this.snapshotAt,
    required List<ProjectCatalogItem> projects,
  }) : projects = List<ProjectCatalogItem>.unmodifiable(projects);

  factory ProjectCatalog.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'snapshotAt', 'projects'});
    final rawProjects = json['projects'];
    if (rawProjects is! List<Object?>) {
      throw const FormatException('Expected a Project catalog list.');
    }
    return ProjectCatalog(
      snapshotAt: json.dateTime('snapshotAt'),
      projects: rawProjects.map((project) {
        if (project is! Map<String, Object?>) {
          throw const FormatException('Expected a Project catalog item.');
        }
        return ProjectCatalogItem.fromJson(project);
      }).toList(),
    );
  }

  final DateTime snapshotAt;
  final List<ProjectCatalogItem> projects;
}

final class ProjectCatalogItem {
  const ProjectCatalogItem({required this.projectId, required this.name});

  factory ProjectCatalogItem.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'projectId', 'name'});
    final projectId = json.string('projectId');
    final name = json.string('name');
    if (projectId.isEmpty || name.isEmpty) {
      throw const FormatException('Project catalog fields must not be empty.');
    }
    return ProjectCatalogItem(projectId: projectId, name: name);
  }

  final String projectId;
  final String name;
}

enum ProjectBoardLane {
  focus,
  inFlight,
  outOfFocus,
  backlog;

  static ProjectBoardLane fromWire(String value) => switch (value) {
    'focus' => ProjectBoardLane.focus,
    'in_flight' => ProjectBoardLane.inFlight,
    'out_of_focus' => ProjectBoardLane.outOfFocus,
    'backlog' => ProjectBoardLane.backlog,
    _ => throw const FormatException('Invalid Project Board lane.'),
  };
}

final class ProjectBoardTask {
  const ProjectBoardTask({
    required this.taskId,
    required this.title,
    required this.lane,
    required this.state,
    required this.reason,
    required this.activityAt,
  });

  factory ProjectBoardTask.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{
      'taskId',
      'title',
      'lane',
      'state',
      'reason',
      'activityAt',
    });
    final taskId = json.string('taskId');
    final title = json.string('title');
    final state = json.string('state');
    final reason = json.string('reason');
    if (<String>[taskId, title, state, reason].any((value) => value.isEmpty)) {
      throw const FormatException(
        'Project Board Task fields must not be empty.',
      );
    }
    return ProjectBoardTask(
      taskId: taskId,
      title: title,
      lane: ProjectBoardLane.fromWire(json.string('lane')),
      state: state,
      reason: reason,
      activityAt: json.dateTime('activityAt'),
    );
  }

  final String taskId;
  final String title;
  final ProjectBoardLane lane;
  final String state;
  final String reason;
  final DateTime activityAt;
}

final class ProjectBoardCounts {
  const ProjectBoardCounts({
    required this.focus,
    required this.inFlight,
    required this.outOfFocus,
    required this.backlog,
  });

  factory ProjectBoardCounts.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{
      'focus',
      'inFlight',
      'outOfFocus',
      'backlog',
    });
    final counts = ProjectBoardCounts(
      focus: json.integer('focus'),
      inFlight: json.integer('inFlight'),
      outOfFocus: json.integer('outOfFocus'),
      backlog: json.integer('backlog'),
    );
    if (<int>[
      counts.focus,
      counts.inFlight,
      counts.outOfFocus,
      counts.backlog,
    ].any((count) => count < 0)) {
      throw const FormatException('Project Board counts must not be negative.');
    }
    return counts;
  }

  final int focus;
  final int inFlight;
  final int outOfFocus;
  final int backlog;
}

final class ProjectBoardLanes {
  ProjectBoardLanes({
    required List<ProjectBoardTask> focus,
    required List<ProjectBoardTask> inFlight,
    required List<ProjectBoardTask> outOfFocus,
    required List<ProjectBoardTask> backlog,
  }) : focus = List<ProjectBoardTask>.unmodifiable(focus),
       inFlight = List<ProjectBoardTask>.unmodifiable(inFlight),
       outOfFocus = List<ProjectBoardTask>.unmodifiable(outOfFocus),
       backlog = List<ProjectBoardTask>.unmodifiable(backlog);

  factory ProjectBoardLanes.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{
      'focus',
      'inFlight',
      'outOfFocus',
      'backlog',
    });
    return ProjectBoardLanes(
      focus: _projectBoardTasks(json, 'focus', ProjectBoardLane.focus),
      inFlight: _projectBoardTasks(json, 'inFlight', ProjectBoardLane.inFlight),
      outOfFocus: _projectBoardTasks(
        json,
        'outOfFocus',
        ProjectBoardLane.outOfFocus,
      ),
      backlog: _projectBoardTasks(json, 'backlog', ProjectBoardLane.backlog),
    );
  }

  final List<ProjectBoardTask> focus;
  final List<ProjectBoardTask> inFlight;
  final List<ProjectBoardTask> outOfFocus;
  final List<ProjectBoardTask> backlog;
}

List<ProjectBoardTask> _projectBoardTasks(
  Map<String, Object?> json,
  String key,
  ProjectBoardLane expectedLane,
) {
  final rawTasks = json[key];
  if (rawTasks is! List<Object?>) {
    throw FormatException('Expected Project Board lane $key.');
  }
  return rawTasks.map((rawTask) {
    if (rawTask is! Map<String, Object?>) {
      throw const FormatException('Expected a Project Board Task.');
    }
    final task = ProjectBoardTask.fromJson(rawTask);
    if (task.lane != expectedLane) {
      throw const FormatException('Project Board Task is in the wrong lane.');
    }
    return task;
  }).toList();
}

final class ProjectBoard {
  const ProjectBoard({
    required this.snapshotAt,
    required this.projectId,
    required this.projectName,
    required this.counts,
    required this.lanes,
  });

  factory ProjectBoard.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{
      'snapshotAt',
      'projectId',
      'projectName',
      'counts',
      'lanes',
    });
    final projectId = json.string('projectId');
    final projectName = json.string('projectName');
    final rawCounts = json['counts'];
    final rawLanes = json['lanes'];
    if (projectId.isEmpty || projectName.isEmpty) {
      throw const FormatException('Project Board identity must not be empty.');
    }
    if (rawCounts is! Map<String, Object?> ||
        rawLanes is! Map<String, Object?>) {
      throw const FormatException('Expected Project Board counts and lanes.');
    }
    final counts = ProjectBoardCounts.fromJson(rawCounts);
    final lanes = ProjectBoardLanes.fromJson(rawLanes);
    if (counts.focus != lanes.focus.length ||
        counts.inFlight != lanes.inFlight.length ||
        counts.outOfFocus != lanes.outOfFocus.length ||
        counts.backlog != lanes.backlog.length) {
      throw const FormatException(
        'Project Board counts do not match lane membership.',
      );
    }
    return ProjectBoard(
      snapshotAt: json.dateTime('snapshotAt'),
      projectId: projectId,
      projectName: projectName,
      counts: counts,
      lanes: lanes,
    );
  }

  final DateTime snapshotAt;
  final String projectId;
  final String projectName;
  final ProjectBoardCounts counts;
  final ProjectBoardLanes lanes;
}

final class TaskDetail {
  const TaskDetail({
    required this.taskId,
    required this.title,
    required this.projectId,
    required this.projectName,
    required this.boardStatus,
    required this.handoffNotes,
    required this.agentState,
    this.agentTerminalAvailable = false,
    required this.agentErrorSummary,
    required this.createdAt,
    required this.updatedAt,
    required this.agentUpdatedAt,
  });

  factory TaskDetail.fromJson(Map<String, Object?> json) {
    const fields = <String>{
      'taskId',
      'title',
      'projectId',
      'projectName',
      'boardStatus',
      'handoffNotes',
      'agentState',
      'agentTerminalAvailable',
      'agentErrorSummary',
      'createdAt',
      'updatedAt',
      'agentUpdatedAt',
    };
    json.expectOnly(fields);
    if (!json.keys.toSet().containsAll(fields)) {
      throw const FormatException('Task detail is missing required fields.');
    }
    final taskId = json.string('taskId');
    final title = json.string('title');
    final projectId = json.string('projectId');
    final projectName = json.string('projectName');
    final boardStatus = json.string('boardStatus');
    final agentState = json.string('agentState');
    final agentTerminalAvailable = json['agentTerminalAvailable'];
    if (<String>[
          taskId,
          title,
          projectId,
          projectName,
        ].any((value) => value.isEmpty) ||
        !const <String>{'backlog', 'doing', 'done'}.contains(boardStatus) ||
        !const <String>{
          'waiting',
          'running',
          'blocked',
          'failed',
          'complete',
        }.contains(agentState) ||
        agentTerminalAvailable is! bool) {
      throw const FormatException('Invalid Task detail.');
    }
    return TaskDetail(
      taskId: taskId,
      title: title,
      projectId: projectId,
      projectName: projectName,
      boardStatus: boardStatus,
      handoffNotes: json.requiredNullableString('handoffNotes'),
      agentState: agentState,
      agentTerminalAvailable: agentTerminalAvailable,
      agentErrorSummary: json.requiredNullableString('agentErrorSummary'),
      createdAt: json.dateTime('createdAt'),
      updatedAt: json.dateTime('updatedAt'),
      agentUpdatedAt: json.nullableDateTime('agentUpdatedAt'),
    );
  }

  final String taskId;
  final String title;
  final String projectId;
  final String projectName;
  final String boardStatus;
  final String? handoffNotes;
  final String agentState;
  final bool agentTerminalAvailable;
  final String? agentErrorSummary;
  final DateTime createdAt;
  final DateTime updatedAt;
  final DateTime? agentUpdatedAt;
}

final class TaskCompleteResult {
  const TaskCompleteResult({
    required this.taskId,
    required this.boardStatus,
    required this.cleanupScheduled,
  });

  factory TaskCompleteResult.fromJson(Map<String, Object?> json) {
    const fields = <String>{'taskId', 'boardStatus', 'cleanupScheduled'};
    json.expectOnly(fields);
    if (!json.keys.toSet().containsAll(fields)) {
      throw const FormatException(
        'Task Complete result is missing required fields.',
      );
    }
    final taskId = json.string('taskId');
    final boardStatus = json.string('boardStatus');
    final cleanupScheduled = json['cleanupScheduled'];
    if (taskId.isEmpty || boardStatus != 'done' || cleanupScheduled is! bool) {
      throw const FormatException('Invalid Task Complete result.');
    }
    return TaskCompleteResult(
      taskId: taskId,
      boardStatus: boardStatus,
      cleanupScheduled: cleanupScheduled,
    );
  }

  final String taskId;
  final String boardStatus;
  final bool cleanupScheduled;
}

final class TaskDeleteReceipt {
  const TaskDeleteReceipt({required this.taskId, required this.outcome});

  factory TaskDeleteReceipt.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'taskId', 'outcome'});
    final taskId = json.string('taskId');
    final outcome = json.string('outcome');
    if (taskId.isEmpty || outcome != 'deleted') {
      throw const FormatException('Invalid Task Delete receipt.');
    }
    return TaskDeleteReceipt(taskId: taskId, outcome: outcome);
  }

  final String taskId;
  final String outcome;
}

enum TaskStartOutcome { started }

final class TaskStartResult {
  const TaskStartResult({required this.taskId, required this.outcome});

  factory TaskStartResult.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'taskId', 'outcome'});
    final taskId = json.string('taskId');
    final outcome = json.string('outcome');
    if (taskId.isEmpty || outcome != 'started') {
      throw const FormatException('Invalid Companion Task Start result.');
    }
    return TaskStartResult(taskId: taskId, outcome: TaskStartOutcome.started);
  }

  final String taskId;
  final TaskStartOutcome outcome;
}

sealed class CompanionResourceIdentityData {
  const CompanionResourceIdentityData();

  factory CompanionResourceIdentityData.fromJson(Map<String, Object?> json) {
    final kind = json.string('kind');
    switch (kind) {
      case 'attention':
        json.expectOnly(const <String>{'kind'});
        return const AttentionResourceIdentityData();
      case 'project_catalog':
        json.expectOnly(const <String>{'kind'});
        return const ProjectCatalogResourceIdentityData();
      case 'project_board':
        json.expectOnly(const <String>{'kind', 'id'});
        final projectId = json.string('id');
        if (projectId.isEmpty) {
          throw const FormatException(
            'Project Board resource id must not be empty.',
          );
        }
        return ProjectBoardResourceIdentityData(projectId);
      case 'task':
        json.expectOnly(const <String>{'kind', 'id'});
        final id = json.string('id');
        if (id.isEmpty) {
          throw const FormatException('Task resource id must not be empty.');
        }
        return TaskResourceIdentityData(id);
      default:
        throw const FormatException('Invalid Companion resource kind.');
    }
  }
}

final class AttentionResourceIdentityData
    extends CompanionResourceIdentityData {
  const AttentionResourceIdentityData();
}

final class ProjectCatalogResourceIdentityData
    extends CompanionResourceIdentityData {
  const ProjectCatalogResourceIdentityData();
}

final class ProjectBoardResourceIdentityData
    extends CompanionResourceIdentityData {
  const ProjectBoardResourceIdentityData(this.id);

  final String id;
}

final class TaskResourceIdentityData extends CompanionResourceIdentityData {
  const TaskResourceIdentityData(this.id);

  final String id;
}

final class ResourceInvalidationData {
  ResourceInvalidationData({
    required List<CompanionResourceIdentityData> resources,
  }) : resources = List<CompanionResourceIdentityData>.unmodifiable(resources);

  factory ResourceInvalidationData.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'resources'});
    final resources = json['resources'];
    if (resources is! List<Object?> || resources.isEmpty) {
      throw const FormatException('Companion invalidation requires resources.');
    }
    return ResourceInvalidationData(
      resources: resources.map((resource) {
        if (resource is! Map<String, Object?>) {
          throw const FormatException('Invalid Companion resource identity.');
        }
        return CompanionResourceIdentityData.fromJson(resource);
      }).toList(),
    );
  }

  final List<CompanionResourceIdentityData> resources;
}

final class StreamGapData {
  const StreamGapData() : refreshRequired = true;

  factory StreamGapData.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'refreshRequired'});
    if (json['refreshRequired'] != true) {
      throw const FormatException('Invalid Companion stream gap.');
    }
    return const StreamGapData();
  }

  final bool refreshRequired;
}

final class AuthorizationRevokedData {
  const AuthorizationRevokedData() : reason = 'revoked';

  factory AuthorizationRevokedData.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'reason'});
    if (json['reason'] != 'revoked') {
      throw const FormatException(
        'Invalid Companion authorization termination.',
      );
    }
    return const AuthorizationRevokedData();
  }

  final String reason;
}

final class GatewayClosingData {
  const GatewayClosingData() : reason = 'shutdown';

  factory GatewayClosingData.fromJson(Map<String, Object?> json) {
    json.expectOnly(const <String>{'reason'});
    if (json['reason'] != 'shutdown') {
      throw const FormatException('Invalid Companion gateway termination.');
    }
    return const GatewayClosingData();
  }

  final String reason;
}

final class CompanionV1Client {
  const CompanionV1Client({required this.baseUrl, required this.transport});

  final Uri baseUrl;
  final CompanionV1Transport transport;

  Future<PairingSubmissionStatus> submitCompanionPairingRequest({
    required String secret,
    required String deviceName,
    required String platform,
  }) async {
    final response = await transport.send(
      method: 'POST',
      uri: baseUrl.resolve('/companion/v1/pairing/requests'),
      headers: const <String, String>{'content-type': 'application/json'},
      body: jsonEncode(<String, Object>{
        'secret': secret,
        'deviceName': deviceName,
        'platform': platform,
      }),
    );
    return PairingSubmissionStatus.fromJson(
      _successJson(response, const <int>{202}),
    );
  }

  Future<PairingPoll> getCompanionPairingRequest({
    required String requestId,
    required String secret,
  }) async {
    final response = await transport.send(
      method: 'GET',
      uri: baseUrl.resolve('/companion/v1/pairing/requests/$requestId'),
      headers: <String, String>{'authorization': 'Pairing $secret'},
    );
    return PairingPoll.fromJson(_successJson(response, const <int>{200, 202}));
  }

  Future<HostStatus> getCompanionHostStatus({
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'GET',
      uri: baseUrl.resolve('/companion/v1/status'),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return HostStatus.fromJson(_successJson(response, const <int>{200}));
  }

  Future<AttentionSnapshot> getCompanionAttention({
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'GET',
      uri: baseUrl.resolve('/companion/v1/attention'),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return AttentionSnapshot.fromJson(_successJson(response, const <int>{200}));
  }

  Future<ProjectCatalog> getCompanionProjects({
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'GET',
      uri: baseUrl.resolve('/companion/v1/projects'),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return ProjectCatalog.fromJson(_successJson(response, const <int>{200}));
  }

  Future<ProjectBoard> getCompanionProjectBoard({
    required String projectId,
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'GET',
      uri: baseUrl.resolve(
        '/companion/v1/projects/${Uri.encodeComponent(projectId)}/board',
      ),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return ProjectBoard.fromJson(_successJson(response, const <int>{200}));
  }

  Future<TaskDetail> getCompanionTaskDetail({
    required String taskId,
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'GET',
      uri: baseUrl.resolve(
        '/companion/v1/tasks/${Uri.encodeComponent(taskId)}',
      ),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return TaskDetail.fromJson(_successJson(response, const <int>{200}));
  }

  Future<TaskCompleteResult> completeCompanionTask({
    required String taskId,
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'POST',
      uri: baseUrl.resolve(
        '/companion/v1/tasks/${Uri.encodeComponent(taskId)}/complete',
      ),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return TaskCompleteResult.fromJson(
      _successJson(response, const <int>{200}),
    );
  }

  Future<TaskDeleteReceipt> deleteCompanionBacklogTask({
    required String taskId,
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'POST',
      uri: baseUrl.resolve(
        '/companion/v1/tasks/${Uri.encodeComponent(taskId)}/delete',
      ),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return TaskDeleteReceipt.fromJson(_successJson(response, const <int>{200}));
  }

  Future<TaskStartResult> startCompanionTask({
    required String taskId,
    required String credential,
  }) async {
    final response = await transport.send(
      method: 'POST',
      uri: baseUrl.resolve(
        '/companion/v1/tasks/${Uri.encodeComponent(taskId)}/start',
      ),
      headers: <String, String>{
        'authorization': 'Bearer $credential',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
    );
    return TaskStartResult.fromJson(_successJson(response, const <int>{200}));
  }

  CompanionV1StreamRequest streamCompanionEvents({
    required String credential,
    String? lastEventId,
  }) => CompanionV1StreamRequest(
    method: 'GET',
    uri: baseUrl.resolve('/companion/v1/events'),
    headers: <String, String>{
      'accept': 'text/event-stream',
      'authorization': 'Bearer $credential',
      companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      'last-event-id': ?lastEventId,
    },
  );
}

Map<String, Object?> _successJson(
  CompanionV1HttpResponse response,
  Set<int> expectedStatuses,
) {
  final decoded = jsonDecode(response.body);
  if (!expectedStatuses.contains(response.statusCode)) {
    if (decoded is Map<String, Object?> &&
        decoded.keys.length == 1 &&
        decoded['error'] is Map<String, Object?>) {
      final error = decoded['error']! as Map<String, Object?>;
      const codes = <String>{
        'unauthenticated',
        'revoked',
        'incompatible_version',
        'invalid_request',
        'invalid_task_state',
        'operation_in_progress',
        'not_found',
        'invalid_state',
        'desktop_action_required',
        'rate_limited',
        'temporarily_unavailable',
      };
      final code = error['code'];
      final message = error['message'];
      final requestId = error['requestId'];
      final validRequestId =
          error.containsKey('requestId') &&
          (requestId == null || requestId is String);
      if (error.keys.length == 3 &&
          code is String &&
          codes.contains(code) &&
          message is String &&
          validRequestId) {
        throw CompanionV1Exception(
          statusCode: response.statusCode,
          code: code,
          message: message,
        );
      }
    }
    throw CompanionV1Exception(
      statusCode: response.statusCode,
      code: 'temporarily_unavailable',
      message: 'The desktop returned an invalid error response.',
    );
  }
  if (decoded is! Map<String, Object?>) {
    throw const FormatException('Expected a Companion response object.');
  }
  return decoded;
}

bool _isUuid(String value) => RegExp(
  r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$',
).hasMatch(value);

bool _isCredential(String value) =>
    value.length == 43 && RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(value);

extension on Map<String, Object?> {
  void expectOnly(Set<String> allowed) {
    if (keys.any((key) => !allowed.contains(key))) {
      throw const FormatException(
        'Companion response contains unknown fields.',
      );
    }
  }

  String string(String key) {
    final value = this[key];
    if (value is! String) throw FormatException('Expected string field $key.');
    return value;
  }

  String? nullableString(String key) {
    if (!containsKey(key)) return null;
    final value = this[key];
    if (value is! String) throw FormatException('Expected string field $key.');
    return value;
  }

  String? requiredNullableString(String key) {
    final value = this[key];
    if (value == null) return null;
    if (value is! String) throw FormatException('Expected string field $key.');
    return value;
  }

  DateTime? nullableDateTime(String key) {
    final value = this[key];
    if (value == null) return null;
    if (value is! String) {
      throw FormatException('Expected date-time field $key.');
    }
    if (!RegExp(
      r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$',
    ).hasMatch(value)) {
      throw FormatException('Expected RFC 3339 field $key.');
    }
    return DateTime.parse(value);
  }

  int integer(String key) {
    final value = this[key];
    if (value is! int) throw FormatException('Expected integer field $key.');
    return value;
  }

  DateTime dateTime(String key) {
    final value = string(key);
    if (!RegExp(
      r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$',
    ).hasMatch(value)) {
      throw FormatException('Expected RFC 3339 field $key.');
    }
    return DateTime.parse(value);
  }
}
