import '../generated/companion_v1_client.dart';
import '../pairing/pairing_bootstrap.dart';
import '../storage/companion_secure_storage.dart';
import 'pinned_companion_transport.dart';

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

  Future<HostStatus> fetchHostStatus(CompanionTrustRecord trustRecord);

  Future<AttentionSnapshot> fetchAttention(CompanionTrustRecord trustRecord);

  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  );
}

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
  }) => _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: bootstrap.endpointCandidates,
    certificateSha256: bootstrap.certificateSha256,
    operation: (client) => client.submitCompanionPairingRequest(
      secret: bootstrap.oneTimeSecret,
      deviceName: deviceName,
      platform: platform,
    ),
  );

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
  }) => _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: bootstrap.endpointCandidates,
    certificateSha256: bootstrap.certificateSha256,
    operation: (client) => client.getCompanionPairingRequest(
      requestId: requestId,
      secret: bootstrap.oneTimeSecret,
    ),
  );

  @override
  Future<HostStatus> fetchHostStatus(CompanionTrustRecord trustRecord) =>
      _tryEndpoints(
        transportFactory: _transportFactory,
        endpoints: trustRecord.endpointCandidates,
        certificateSha256: trustRecord.certificateSha256,
        operation: (client) => client.getCompanionHostStatus(
          credential: trustRecord.deviceCredential,
        ),
      );

  @override
  Future<AttentionSnapshot> fetchAttention(CompanionTrustRecord trustRecord) =>
      _tryEndpoints(
        transportFactory: _transportFactory,
        endpoints: trustRecord.endpointCandidates,
        certificateSha256: trustRecord.certificateSha256,
        operation: (client) => client.getCompanionAttention(
          credential: trustRecord.deviceCredential,
        ),
      );

  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => _tryEndpoints(
    transportFactory: _transportFactory,
    endpoints: trustRecord.endpointCandidates,
    certificateSha256: trustRecord.certificateSha256,
    operation: (client) => client.getCompanionTaskDetail(
      taskId: taskId,
      credential: trustRecord.deviceCredential,
    ),
  );
}

Future<T> _tryEndpoints<T>({
  required CompanionEndpointTransportFactory transportFactory,
  required List<Uri> endpoints,
  required String certificateSha256,
  required Future<T> Function(CompanionV1Client client) operation,
}) async {
  Object? lastError;
  var certificateMismatches = 0;
  for (final endpoint in endpoints) {
    final transportHandle = transportFactory(certificateSha256);
    try {
      return await operation(
        CompanionV1Client(
          baseUrl: endpoint,
          transport: transportHandle.transport,
        ),
      );
    } on CompanionCertificateMismatch catch (error) {
      certificateMismatches += 1;
      lastError = error;
    } on CompanionV1Exception {
      rethrow;
    } on Object catch (error) {
      lastError = error;
    } finally {
      transportHandle.close();
    }
  }
  if (certificateMismatches == endpoints.length) {
    throw const CompanionCertificateMismatch();
  }
  throw lastError ??
      StateError('No Companion endpoint candidates are available.');
}
