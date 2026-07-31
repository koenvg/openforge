import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';

import '../generated/companion_v1_client.dart';
import 'pinned_companion_transport.dart';

sealed class CompanionLiveEvent {
  const CompanionLiveEvent({this.eventId});

  final String? eventId;
}

final class CompanionResourceInvalidation {
  const CompanionResourceInvalidation.attention()
    : kind = CompanionResourceKind.attention,
      id = null;

  const CompanionResourceInvalidation.task(String taskId)
    : kind = CompanionResourceKind.task,
      id = taskId;

  final CompanionResourceKind kind;
  final String? id;
}

enum CompanionResourceKind { attention, task }

final class CompanionResourcesInvalidated extends CompanionLiveEvent {
  const CompanionResourcesInvalidated({
    required super.eventId,
    required this.resources,
  });

  final List<CompanionResourceInvalidation> resources;
}

final class CompanionStreamGap extends CompanionLiveEvent {
  const CompanionStreamGap({required super.eventId});
}

final class CompanionAuthorizationRevoked extends CompanionLiveEvent {
  const CompanionAuthorizationRevoked();
}

final class CompanionGatewayClosing extends CompanionLiveEvent {
  const CompanionGatewayClosing();
}

abstract interface class CompanionLiveConnection {
  Stream<CompanionLiveEvent> get events;

  Future<void> close();
}

typedef CompanionEventConnector =
    Future<CompanionLiveConnection> Function({
      required Uri endpoint,
      required String certificateSha256,
      required String credential,
      String? lastEventId,
    });

Future<CompanionLiveConnection> openPinnedCompanionEvents({
  required Uri endpoint,
  required String certificateSha256,
  required String credential,
  String? lastEventId,
}) async {
  final transport = PinnedCompanionTransport(
    certificateSha256: certificateSha256,
  );
  try {
    final request = CompanionV1Client(
      baseUrl: endpoint,
      transport: transport,
    ).streamCompanionEvents(credential: credential, lastEventId: lastEventId);
    final response = await transport.openStream(
      method: request.method,
      uri: request.uri,
      headers: request.headers,
    );
    if (response.statusCode != HttpStatus.ok) {
      final body = await utf8.decoder.bind(response).join();
      throw _protocolException(response.statusCode, body);
    }
    return _HttpCompanionLiveConnection(response, transport);
  } on Object {
    transport.close();
    rethrow;
  }
}

final class _HttpCompanionLiveConnection implements CompanionLiveConnection {
  _HttpCompanionLiveConnection(HttpClientResponse response, this._transport)
    : _events = decodeCompanionSseLines(
        utf8.decoder.bind(response).transform(const LineSplitter()),
      ).asBroadcastStream();

  final PinnedCompanionTransport _transport;
  final Stream<CompanionLiveEvent> _events;
  var _closed = false;

  @override
  Stream<CompanionLiveEvent> get events => _events;

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _transport.close();
  }
}

@visibleForTesting
Stream<CompanionLiveEvent> decodeCompanionSseLines(
  Stream<String> lines,
) async* {
  String? eventName;
  String? eventId;
  final data = <String>[];

  await for (final line in lines) {
    if (line.isEmpty) {
      final event = _decodeEvent(eventName, eventId, data.join('\n'));
      if (event != null) yield event;
      eventName = null;
      data.clear();
      continue;
    }
    if (line.startsWith(':')) continue;
    final separator = line.indexOf(':');
    final field = separator < 0 ? line : line.substring(0, separator);
    var value = separator < 0 ? '' : line.substring(separator + 1);
    if (value.startsWith(' ')) value = value.substring(1);
    switch (field) {
      case 'event':
        eventName = value;
      case 'id':
        eventId = value;
      case 'data':
        data.add(value);
    }
  }
}

CompanionLiveEvent? _decodeEvent(
  String? eventName,
  String? eventId,
  String data,
) => switch (eventName) {
  'resources-invalidated' => _decodeResources(eventId, data),
  'stream-gap' => _decodeGap(eventId, data),
  'authorization-revoked' => _decodeAuthorizationRevoked(data),
  'gateway-closing' => _decodeGatewayClosing(data),
  _ => null,
};

CompanionResourcesInvalidated _decodeResources(String? eventId, String data) {
  final payload = ResourceInvalidationData.fromJson(
    _decodeDataObject(data, 'Invalid Companion resource invalidation.'),
  );
  final resources = payload.resources
      .map(
        (resource) => switch (resource) {
          AttentionResourceIdentityData() =>
            const CompanionResourceInvalidation.attention(),
          TaskResourceIdentityData(:final id) =>
            CompanionResourceInvalidation.task(id),
        },
      )
      .toList(growable: false);
  return CompanionResourcesInvalidated(
    eventId: _requiredEventId(eventId),
    resources: List<CompanionResourceInvalidation>.unmodifiable(resources),
  );
}

CompanionStreamGap _decodeGap(String? eventId, String data) {
  StreamGapData.fromJson(
    _decodeDataObject(data, 'Invalid Companion stream gap.'),
  );
  return CompanionStreamGap(eventId: _requiredEventId(eventId));
}

CompanionAuthorizationRevoked _decodeAuthorizationRevoked(String data) {
  AuthorizationRevokedData.fromJson(
    _decodeDataObject(data, 'Invalid Companion authorization termination.'),
  );
  return const CompanionAuthorizationRevoked();
}

CompanionGatewayClosing _decodeGatewayClosing(String data) {
  GatewayClosingData.fromJson(
    _decodeDataObject(data, 'Invalid Companion gateway termination.'),
  );
  return const CompanionGatewayClosing();
}

Map<String, Object?> _decodeDataObject(String data, String message) {
  final json = jsonDecode(data);
  if (json is! Map<String, Object?>) throw FormatException(message);
  return json;
}

String _requiredEventId(String? eventId) {
  if (eventId == null || eventId.isEmpty) {
    throw const FormatException('Companion event cursor is missing.');
  }
  return eventId;
}

CompanionV1Exception _protocolException(int statusCode, String body) {
  try {
    final json = jsonDecode(body);
    if (json is Map<String, Object?> && json['error'] is Map<String, Object?>) {
      final error = json['error']! as Map<String, Object?>;
      final code = error['code'];
      final message = error['message'];
      if (code is String && message is String) {
        return CompanionV1Exception(
          statusCode: statusCode,
          code: code,
          message: message,
        );
      }
    }
  } on FormatException {
    // Fall through to the stable transport error below.
  }
  return CompanionV1Exception(
    statusCode: statusCode,
    code: 'temporarily_unavailable',
    message: 'Companion event stream is unavailable.',
  );
}
