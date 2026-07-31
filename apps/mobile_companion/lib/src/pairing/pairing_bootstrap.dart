import 'dart:convert';

final class PairingBootstrap {
  PairingBootstrap({
    required this.protocolVersion,
    required this.hostId,
    required this.certificateSha256,
    required List<Uri> endpointCandidates,
    required this.oneTimeSecret,
  }) : endpointCandidates = List<Uri>.unmodifiable(endpointCandidates);

  factory PairingBootstrap.parse(String qrPayload) {
    final decoded = jsonDecode(qrPayload);
    if (decoded is! Map<String, Object?> ||
        !const <String>{
          'protocolVersion',
          'hostId',
          'certificateSha256',
          'endpointCandidates',
          'oneTimeSecret',
        }.containsAll(decoded.keys) ||
        decoded.length != 5) {
      throw const FormatException('Invalid Companion pairing QR.');
    }
    final protocolVersion = decoded['protocolVersion'];
    final hostId = decoded['hostId'];
    final certificateSha256 = decoded['certificateSha256'];
    final endpoints = decoded['endpointCandidates'];
    final oneTimeSecret = decoded['oneTimeSecret'];
    if (protocolVersion is! int ||
        hostId is! String ||
        certificateSha256 is! String ||
        endpoints is! List<Object?> ||
        oneTimeSecret is! String ||
        endpoints.any((endpoint) => endpoint is! String)) {
      throw const FormatException('Invalid Companion pairing QR.');
    }
    final endpointCandidates = endpoints
        .cast<String>()
        .map(Uri.parse)
        .toList(growable: false);
    final normalizedFingerprint = certificateSha256.replaceAll(':', '');
    if (protocolVersion != 1 ||
        hostId.isEmpty ||
        !RegExp(r'^[0-9A-Fa-f]{64}$').hasMatch(normalizedFingerprint) ||
        endpointCandidates.isEmpty ||
        endpointCandidates.any(
          (endpoint) => endpoint.scheme != 'https' || endpoint.host.isEmpty,
        ) ||
        !RegExp(r'^[A-Za-z0-9_-]{43}$').hasMatch(oneTimeSecret)) {
      throw const FormatException('Invalid Companion pairing QR.');
    }
    return PairingBootstrap(
      protocolVersion: protocolVersion,
      hostId: hostId,
      certificateSha256: certificateSha256,
      endpointCandidates: endpointCandidates,
      oneTimeSecret: oneTimeSecret,
    );
  }

  final int protocolVersion;
  final String hostId;
  final String certificateSha256;
  final List<Uri> endpointCandidates;
  final String oneTimeSecret;
}
