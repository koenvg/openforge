import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:crypto/crypto.dart';

import '../generated/companion_v1_client.dart';

final class CompanionCertificateMismatch implements Exception {
  const CompanionCertificateMismatch();
}

String normalizedCertificateFingerprint(String value) =>
    value.replaceAll(':', '').replaceAll(RegExp(r'\s'), '').toLowerCase();

bool certificateMatchesPin(Uint8List certificateDer, String expectedSha256) {
  final actual = sha256.convert(certificateDer).toString();
  return actual == normalizedCertificateFingerprint(expectedSha256);
}

abstract interface class CloseableCompanionV1Transport
    implements CompanionV1Transport {
  void close();
}

final class PinnedCompanionTransport implements CloseableCompanionV1Transport {
  factory PinnedCompanionTransport({
    required String certificateSha256,
    HttpClient? client,
    Duration timeout = const Duration(seconds: 10),
  }) {
    final pinDecision = _PinDecision();
    return PinnedCompanionTransport._(
      certificateSha256: certificateSha256,
      client: client ?? _createPinnedClient(certificateSha256, pinDecision),
      pinDecision: pinDecision,
      timeout: timeout,
    );
  }

  PinnedCompanionTransport._({
    required this.certificateSha256,
    required this._client,
    required this._pinDecision,
    required this.timeout,
  });

  final String certificateSha256;
  final Duration timeout;
  final HttpClient _client;
  final _PinDecision _pinDecision;

  static HttpClient _createPinnedClient(
    String certificateSha256,
    _PinDecision pinDecision,
  ) {
    final context = SecurityContext(withTrustedRoots: false);
    final client = HttpClient(context: context);
    client.badCertificateCallback = (certificate, _, _) {
      final matches = certificateMatchesPin(certificate.der, certificateSha256);
      pinDecision.rejected = !matches;
      return matches;
    };
    return client;
  }

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    final response = await openStream(
      method: method,
      uri: uri,
      headers: headers,
      body: body,
    );
    final responseBody = await utf8.decoder
        .bind(response)
        .join()
        .timeout(timeout);
    return CompanionV1HttpResponse(
      statusCode: response.statusCode,
      body: responseBody,
    );
  }

  Future<HttpClientResponse> openStream({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    try {
      final request = await _client.openUrl(method, uri).timeout(timeout);
      request.followRedirects = false;
      headers.forEach((name, value) => request.headers.set(name, value));
      if (body != null) request.write(body);
      return await request.close().timeout(timeout);
    } on HandshakeException {
      if (_pinDecision.rejected) {
        throw const CompanionCertificateMismatch();
      }
      rethrow;
    }
  }

  @override
  void close() => _client.close(force: true);
}

final class _PinDecision {
  bool rejected = false;
}
