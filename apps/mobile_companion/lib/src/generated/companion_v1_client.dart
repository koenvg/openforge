// GENERATED CODE - DO NOT MODIFY BY HAND.
// Source: docs/contracts/companion-v1.openapi.json (OpenAPI 3.1, v1.0.0).

import 'dart:convert';

const companionV1OpenApiSha256 =
    '1d8c959c7eb09a384f4e410c5ea3f772da5e707f49f74eeb5d1db337b31c01b4';

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
      headers: <String, String>{'authorization': 'Bearer $credential'},
    );
    return HostStatus.fromJson(_successJson(response, const <int>{200}));
  }
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
