/// The status resource returned by the versioned companion API.
final class CompanionHostStatus {
  const CompanionHostStatus({
    required this.hostId,
    required this.protocolVersion,
  });

  final String hostId;
  final int protocolVersion;
}

/// Coarse public invalidations delivered by the companion event stream.
enum CompanionEvent {
  attentionChanged,
  hostStatusChanged,
  authorizationRevoked,
  gatewayClosing,
}

/// The only test seam for companion API requests and event streaming.
///
/// A later generated OpenAPI adapter will implement this interface. Keeping the
/// generated transport behind one seam prevents widgets and state controllers
/// from depending on generated code or SSE implementation details. The adapter
/// owns event cursors and transport reconnection so callers cannot create a
/// partially resumed stream.
abstract interface class CompanionClient {
  Future<CompanionHostStatus> fetchHostStatus();

  Stream<CompanionEvent> watchEvents();
}
