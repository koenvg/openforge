import 'dart:async';

import '../generated/companion_v1_client.dart';
import '../pairing/pairing_bootstrap.dart';
import '../storage/companion_secure_storage.dart';
import 'companion_live_events.dart';
import 'pinned_companion_transport.dart';

export 'companion_live_events.dart';

typedef CompanionEndpointTransportFactory =
    CompanionEndpointTransport Function(String certificateSha256);

final class CompanionEndpointTransport {
  const CompanionEndpointTransport({
    required this.transport,
    required this.close,
  });

  final CompanionV1Transport transport;
  final void Function() close;
}

CompanionEndpointTransport _pinnedTransport(String certificateSha256) {
  final transport = PinnedCompanionTransport(
    certificateSha256: certificateSha256,
  );
  return CompanionEndpointTransport(
    transport: transport,
    close: transport.close,
  );
}

final class CompanionHostConnection {
  const CompanionHostConnection({required this.endpoint, required this.status});

  final Uri endpoint;
  final HostStatus status;
}

typedef CompanionPairingDiagnostic = void Function(String message);

/// The single fake seam for pairing and generated Companion v1 calls.
abstract interface class CompanionClient {
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  });

  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
    CompanionPairingDiagnostic? onDiagnostic,
  });

  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  );

  Future<AttentionSnapshot> fetchAttention(CompanionTrustRecord trustRecord);

  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  );

  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  });
}

final class GeneratedCompanionClient implements CompanionClient {
  factory GeneratedCompanionClient({
    CompanionEndpointTransportFactory transportFactory = _pinnedTransport,
    CompanionEventConnector eventConnector = openPinnedCompanionEvents,
    Duration pairingCandidateTimeout = const Duration(seconds: 3),
    Duration pairingOverallTimeout = const Duration(seconds: 18),
  }) => GeneratedCompanionClient._(
    transportFactory,
    eventConnector,
    pairingCandidateTimeout,
    pairingOverallTimeout,
  );

  GeneratedCompanionClient._(
    this._transportFactory,
    this._eventConnector,
    this._pairingCandidateTimeout,
    this._pairingOverallTimeout,
  );

  final CompanionEndpointTransportFactory _transportFactory;
  final CompanionEventConnector _eventConnector;
  final Duration _pairingCandidateTimeout;
  final Duration _pairingOverallTimeout;
  final _preferredPairingEndpoints = <String, Uri>{};

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  }) async {
    final result = await _tryPairingEndpoints(
      transportFactory: _transportFactory,
      endpoints: bootstrap.endpointCandidates,
      certificateSha256: bootstrap.certificateSha256,
      candidateTimeout: _pairingCandidateTimeout,
      overallTimeout: _pairingOverallTimeout,
      onDiagnostic: onDiagnostic,
      operation: (client) => client.submitCompanionPairingRequest(
        secret: bootstrap.oneTimeSecret,
        deviceName: deviceName,
        platform: platform,
      ),
    );
    _preferredPairingEndpoints[bootstrap.hostId] = result.endpoint;
    return result.value;
  }

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
    CompanionPairingDiagnostic? onDiagnostic,
  }) async => (await _tryPairingEndpoints(
    transportFactory: _transportFactory,
    endpoints: _preferEndpoint(
      bootstrap.endpointCandidates,
      _preferredPairingEndpoints[bootstrap.hostId],
    ),
    certificateSha256: bootstrap.certificateSha256,
    candidateTimeout: _pairingCandidateTimeout,
    overallTimeout: _pairingOverallTimeout,
    onDiagnostic: onDiagnostic,
    operation: (client) => client.getCompanionPairingRequest(
      requestId: requestId,
      secret: bootstrap.oneTimeSecret,
    ),
  )).value;

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async {
    final result = await _tryEndpoints(
      transportFactory: _transportFactory,
      endpoints: _preferEndpoint(
        trustRecord.endpointCandidates,
        _preferredPairingEndpoints[trustRecord.hostId],
      ),
      certificateSha256: trustRecord.certificateSha256,
      operation: (client) => client.getCompanionHostStatus(
        credential: trustRecord.deviceCredential,
      ),
    );
    return CompanionHostConnection(
      endpoint: result.endpoint,
      status: result.value,
    );
  }

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async => (await _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: trustRecord.endpointCandidates,
    certificateSha256: trustRecord.certificateSha256,
    operation: (client) =>
        client.getCompanionAttention(credential: trustRecord.deviceCredential),
  )).value;

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) async => (await _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: trustRecord.endpointCandidates,
    certificateSha256: trustRecord.certificateSha256,
    operation: (client) => client.getCompanionTaskDetail(
      taskId: taskId,
      credential: trustRecord.deviceCredential,
    ),
  )).value;

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) async => (await _tryEndpointCandidates(
    endpoints: trustRecord.endpointCandidates,
    operation: (endpoint) => _eventConnector(
      endpoint: endpoint,
      certificateSha256: trustRecord.certificateSha256,
      credential: trustRecord.deviceCredential,
      lastEventId: lastEventId,
    ),
  )).value;
}

List<Uri> _preferEndpoint(List<Uri> endpoints, Uri? preferred) {
  if (preferred == null || !endpoints.contains(preferred)) return endpoints;
  return <Uri>[
    preferred,
    ...endpoints.where((endpoint) => endpoint != preferred),
  ];
}

Future<_EndpointResult<T>> _tryPairingEndpoints<T>({
  required CompanionEndpointTransportFactory transportFactory,
  required List<Uri> endpoints,
  required String certificateSha256,
  required Duration candidateTimeout,
  required Duration overallTimeout,
  required Future<T> Function(CompanionV1Client client) operation,
  CompanionPairingDiagnostic? onDiagnostic,
}) async {
  final stopwatch = Stopwatch()..start();
  Object? lastError;
  var sawCertificateMismatch = false;
  for (final endpoint in endpoints) {
    final remaining = overallTimeout - stopwatch.elapsed;
    if (remaining <= Duration.zero) break;
    final attemptTimeout = remaining < candidateTimeout
        ? remaining
        : candidateTimeout;
    onDiagnostic?.call('endpoint started: $endpoint');
    final transportHandle = transportFactory(certificateSha256);
    try {
      final value = await operation(
        CompanionV1Client(
          baseUrl: endpoint,
          transport: transportHandle.transport,
        ),
      ).timeout(attemptTimeout);
      onDiagnostic?.call('endpoint succeeded: $endpoint');
      return _EndpointResult(endpoint: endpoint, value: value);
    } on TimeoutException catch (error) {
      lastError = error;
      onDiagnostic?.call(
        'endpoint timed out: $endpoint after ${attemptTimeout.inMilliseconds}ms',
      );
    } on CompanionCertificateMismatch catch (error) {
      sawCertificateMismatch = true;
      lastError = error;
      onDiagnostic?.call('endpoint certificate mismatch: $endpoint');
    } on CompanionV1Exception catch (error) {
      onDiagnostic?.call(
        'endpoint failed: $endpoint — ${error.runtimeType}: $error',
      );
      if (!_isRetryableEndpointError(error)) rethrow;
      lastError = error;
    } on FormatException catch (error) {
      onDiagnostic?.call(
        'endpoint returned an invalid response: $endpoint — $error',
      );
      rethrow;
    } on Object catch (error) {
      lastError = error;
      onDiagnostic?.call(
        'endpoint failed: $endpoint — ${error.runtimeType}: $error',
      );
    } finally {
      transportHandle.close();
    }
  }
  if (sawCertificateMismatch) {
    throw const CompanionCertificateMismatch();
  }
  throw CompanionPairingReachabilityException(
    'Could not reach the desktop through any pinned endpoint. Tried '
    '${endpoints.length} candidate(s) within a bounded '
    '${overallTimeout.inSeconds}s window. Keep Tailscale connected and '
    'generate a fresh pairing code.',
    lastError,
  );
}

final class CompanionPairingReachabilityException implements Exception {
  const CompanionPairingReachabilityException(this.message, this.cause);

  final String message;
  final Object? cause;

  @override
  String toString() => cause == null ? message : '$message Last error: $cause';
}

final class _EndpointResult<T> {
  const _EndpointResult({required this.endpoint, required this.value});

  final Uri endpoint;
  final T value;
}

Future<_EndpointResult<T>> _tryEndpoints<T>({
  required CompanionEndpointTransportFactory transportFactory,
  required List<Uri> endpoints,
  required String certificateSha256,
  required Future<T> Function(CompanionV1Client client) operation,
}) => _tryEndpointCandidates(
  endpoints: endpoints,
  operation: (endpoint) async {
    final transportHandle = transportFactory(certificateSha256);
    try {
      return await operation(
        CompanionV1Client(
          baseUrl: endpoint,
          transport: transportHandle.transport,
        ),
      );
    } finally {
      transportHandle.close();
    }
  },
);

Future<_EndpointResult<T>> _tryEndpointCandidates<T>({
  required List<Uri> endpoints,
  required Future<T> Function(Uri endpoint) operation,
}) async {
  Object? lastError;
  var sawCertificateMismatch = false;
  for (final endpoint in endpoints) {
    try {
      return _EndpointResult(
        endpoint: endpoint,
        value: await operation(endpoint),
      );
    } on CompanionCertificateMismatch catch (error) {
      sawCertificateMismatch = true;
      lastError = error;
    } on CompanionV1Exception catch (error) {
      if (!_isRetryableEndpointError(error)) rethrow;
      lastError = error;
    } on FormatException {
      rethrow;
    } on Object catch (error) {
      lastError = error;
    }
  }
  if (sawCertificateMismatch) {
    throw const CompanionCertificateMismatch();
  }
  throw lastError ??
      StateError('No Companion endpoint candidates are available.');
}

bool _isRetryableEndpointError(CompanionV1Exception error) =>
    error.code == 'rate_limited' || error.code == 'temporarily_unavailable';
