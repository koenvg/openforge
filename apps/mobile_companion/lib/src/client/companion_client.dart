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
}

final class GeneratedCompanionClient implements CompanionClient {
  const GeneratedCompanionClient();

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  }) => _tryEndpoints(
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
        endpoints: trustRecord.endpointCandidates,
        certificateSha256: trustRecord.certificateSha256,
        operation: (client) => client.getCompanionHostStatus(
          credential: trustRecord.deviceCredential,
        ),
      );
}

Future<T> _tryEndpoints<T>({
  required List<Uri> endpoints,
  required String certificateSha256,
  required Future<T> Function(CompanionV1Client client) operation,
}) async {
  Object? lastError;
  var certificateMismatches = 0;
  for (final endpoint in endpoints) {
    final transport = PinnedCompanionTransport(
      certificateSha256: certificateSha256,
    );
    try {
      return await operation(
        CompanionV1Client(baseUrl: endpoint, transport: transport),
      );
    } on CompanionCertificateMismatch catch (error) {
      certificateMismatches += 1;
      lastError = error;
    } on Object catch (error) {
      lastError = error;
    } finally {
      transport.close();
    }
  }
  if (certificateMismatches == endpoints.length) {
    throw const CompanionCertificateMismatch();
  }
  throw lastError ??
      StateError('No Companion endpoint candidates are available.');
}
