import '../generated/companion_v1_client.dart';
import '../pairing/pairing_bootstrap.dart';
import '../storage/companion_secure_storage.dart';
import 'pinned_companion_transport.dart';

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

/// The single fake seam for pairing and generated Companion v1 calls.
abstract interface class CompanionClient {
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  });

  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
  });

  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  );

  Future<AttentionSnapshot> fetchAttention(CompanionTrustRecord trustRecord);

  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  );
}

final class GeneratedCompanionClient implements CompanionClient {
  factory GeneratedCompanionClient({
    CompanionEndpointTransportFactory transportFactory = _pinnedTransport,
  }) => GeneratedCompanionClient._(transportFactory);

  GeneratedCompanionClient._(this._transportFactory);

  final CompanionEndpointTransportFactory _transportFactory;

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  }) async => (await _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: bootstrap.endpointCandidates,
    certificateSha256: bootstrap.certificateSha256,
    operation: (client) => client.submitCompanionPairingRequest(
      secret: bootstrap.oneTimeSecret,
      deviceName: deviceName,
      platform: platform,
    ),
  )).value;

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
  }) async => (await _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: bootstrap.endpointCandidates,
    certificateSha256: bootstrap.certificateSha256,
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
      endpoints: trustRecord.endpointCandidates,
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
}) async {
  Object? lastError;
  var sawCertificateMismatch = false;
  for (final endpoint in endpoints) {
    final transportHandle = transportFactory(certificateSha256);
    try {
      final value = await operation(
        CompanionV1Client(
          baseUrl: endpoint,
          transport: transportHandle.transport,
        ),
      );
      return _EndpointResult(endpoint: endpoint, value: value);
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
    } finally {
      transportHandle.close();
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
