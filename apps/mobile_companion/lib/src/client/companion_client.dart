import '../generated/companion_v1_client.dart';
import '../pairing/pairing_bootstrap.dart';
import '../storage/companion_secure_storage.dart';
import 'pinned_companion_transport.dart';

typedef CompanionTransportFactory =
    CloseableCompanionV1Transport Function(String certificateSha256);

CloseableCompanionV1Transport _createPinnedTransport(
  String certificateSha256,
) => PinnedCompanionTransport(certificateSha256: certificateSha256);

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
}

final class GeneratedCompanionClient implements CompanionClient {
  const GeneratedCompanionClient({
    this.transportFactory = _createPinnedTransport,
  });

  final CompanionTransportFactory transportFactory;

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  }) async => (await _tryEndpoints(
    endpoints: bootstrap.endpointCandidates,
    certificateSha256: bootstrap.certificateSha256,
    transportFactory: transportFactory,
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
    endpoints: bootstrap.endpointCandidates,
    certificateSha256: bootstrap.certificateSha256,
    transportFactory: transportFactory,
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
      endpoints: trustRecord.endpointCandidates,
      certificateSha256: trustRecord.certificateSha256,
      transportFactory: transportFactory,
      operation: (client) => client.getCompanionHostStatus(
        credential: trustRecord.deviceCredential,
      ),
    );
    return CompanionHostConnection(
      endpoint: result.endpoint,
      status: result.value,
    );
  }
}

final class _EndpointResult<T> {
  const _EndpointResult({required this.endpoint, required this.value});

  final Uri endpoint;
  final T value;
}

Future<_EndpointResult<T>> _tryEndpoints<T>({
  required List<Uri> endpoints,
  required String certificateSha256,
  required CompanionTransportFactory transportFactory,
  required Future<T> Function(CompanionV1Client client) operation,
}) async {
  Object? lastError;
  var sawCertificateMismatch = false;
  for (final endpoint in endpoints) {
    final transport = transportFactory(certificateSha256);
    try {
      final value = await operation(
        CompanionV1Client(baseUrl: endpoint, transport: transport),
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
      transport.close();
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
