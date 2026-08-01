// GENERATED CODE - DO NOT MODIFY BY HAND.
// Source: docs/contracts/companion-v1.openapi.json (OpenAPI 3.1, v1.0.0).

import 'dart:convert';

const companionV1OpenApiSha256 =
    '37a7db7cb002c221a5e0a3a3316e9f8265e13c2e51d8b031b1b325e1fe5c2f0c';
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

sealed class CompanionResourceIdentityData {
  const CompanionResourceIdentityData();

  factory CompanionResourceIdentityData.fromJson(Map<String, Object?> json) {
    final kind = json.string('kind');
    switch (kind) {
      case 'attention':
        json.expectOnly(const <String>{'kind'});
        return const AttentionResourceIdentityData();
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
        'not_found',
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
