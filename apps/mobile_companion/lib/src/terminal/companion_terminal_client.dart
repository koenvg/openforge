import 'dart:async';
import 'dart:io';

import '../client/pinned_companion_transport.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';

final class TerminalConnectRequest {
  const TerminalConnectRequest({
    required this.endpoint,
    required this.certificateSha256,
    required this.credential,
    required this.taskId,
  });

  final Uri endpoint;
  final String certificateSha256;
  final String credential;
  final String taskId;
}

typedef CompanionTerminalConnector =
    Future<CompanionAgentTerminalChannel> Function(
      TerminalConnectRequest request,
    );

abstract interface class CompanionTerminalClient {
  Future<CompanionAgentTerminalChannel> openAgentTerminal(
    CompanionTrustRecord trustRecord,
    String taskId,
  );
}

abstract interface class CompanionAgentTerminalChannel {
  Stream<Object> get frames;

  void sendText(String message);

  Future<void> close();
}

Future<CompanionAgentTerminalChannel> openPinnedAgentTerminal(
  TerminalConnectRequest request,
) async {
  var certificateRejected = false;
  final context = SecurityContext(withTrustedRoots: false);
  final client = HttpClient(context: context);
  client.badCertificateCallback = (certificate, _, _) {
    final matches = certificateMatchesPin(
      certificate.der,
      request.certificateSha256,
    );
    certificateRejected = !matches;
    return matches;
  };
  final uri = request.endpoint.replace(
    scheme: request.endpoint.scheme == 'https' ? 'wss' : 'ws',
    pathSegments: <String>[
      'companion',
      'v1',
      'tasks',
      request.taskId,
      'agent-terminal',
    ],
    query: null,
    fragment: null,
  );
  try {
    final socket = await WebSocket.connect(
      uri.toString(),
      headers: <String, String>{
        HttpHeaders.authorizationHeader: 'Bearer ${request.credential}',
        companionV1ProtocolVersionHeader: companionV1ProtocolVersion,
      },
      customClient: client,
    ).timeout(const Duration(seconds: 10));
    return _IoCompanionAgentTerminalChannel(socket, client);
  } on HandshakeException {
    client.close(force: true);
    if (certificateRejected) throw const CompanionCertificateMismatch();
    rethrow;
  } on Object {
    client.close(force: true);
    rethrow;
  }
}

final class _IoCompanionAgentTerminalChannel
    implements CompanionAgentTerminalChannel {
  _IoCompanionAgentTerminalChannel(this._socket, this._client);

  final WebSocket _socket;
  final HttpClient _client;

  @override
  Stream<Object> get frames => _socket.cast<Object>();

  @override
  void sendText(String message) => _socket.add(message);

  @override
  Future<void> close() async {
    await _socket.close();
    _client.close(force: true);
  }
}
