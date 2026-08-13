import 'dart:async';

import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../client/pinned_companion_transport.dart';
import '../connection/companion_connection_state.dart';
import '../discovery/companion_discovery.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';
import 'pairing_bootstrap.dart';

final class CompanionPairingController extends ChangeNotifier {
  factory CompanionPairingController({
    required CompanionClient client,
    required CompanionSecureStorage storage,
    CompanionEndpointDiscovery discovery =
        const NoopCompanionEndpointDiscovery(),
    Duration pollInterval = const Duration(seconds: 1),
    Duration submissionTimeout = const Duration(seconds: 20),
  }) => CompanionPairingController._(
    client,
    storage,
    discovery,
    pollInterval,
    submissionTimeout,
  );

  CompanionPairingController._(
    this._client,
    this._storage,
    this._discovery,
    this._pollInterval,
    this._submissionTimeout,
  );

  final CompanionClient _client;
  final CompanionSecureStorage _storage;
  final CompanionEndpointDiscovery _discovery;
  final Duration _pollInterval;
  final Duration _submissionTimeout;

  var _operationGeneration = 0;

  CompanionConnectionState _state = const Restoring();
  Connected? _lastConnected;
  CompanionConnectionState get state => _state;

  Future<void> restore() async {
    final generation = ++_operationGeneration;
    _setState(const Restoring());
    try {
      final trustRecord = await _storage.load();
      if (!_isCurrent(generation)) return;
      if (trustRecord == null) {
        _setState(const Unpaired());
        return;
      }
      await _connect(trustRecord, generation);
    } on FormatException {
      if (!_isCurrent(generation)) return;
      try {
        await _storage.forget();
        if (_isCurrent(generation)) _setState(const Unpaired());
      } on Object {
        if (_isCurrent(generation)) _setState(const Unavailable());
      }
    } on Object {
      if (_isCurrent(generation)) _setState(const Unavailable());
    }
  }

  Future<void> openLocalNetworkSettings() => _discovery.openSettings();

  void authorizationLost() {
    _operationGeneration += 1;
    _setState(const Revoked());
  }

  void gatewayClosing() {
    _operationGeneration += 1;
    if (_state is Connected) _setState(const Reconnecting());
  }

  void liveReconnecting() {
    if (_state is Connected || _state is Reconnecting) {
      _setState(const Reconnecting());
    }
  }

  void liveConnected() {
    final connected = _lastConnected;
    if (connected != null && _state is Reconnecting) _setState(connected);
  }

  void liveUnavailable() => _setState(const Unavailable());

  void liveCertificateMismatch() => _setState(const CertificateMismatch());

  void liveIncompatible() => _setState(const IncompatibleProtocol());

  void cancelPendingOperation() {
    _operationGeneration += 1;
  }

  @override
  void dispose() {
    cancelPendingOperation();
    super.dispose();
  }

  Future<void> forgetAndReset() async {
    _operationGeneration += 1;
    await _storage.forget();
    _setState(const Unpaired());
  }

  Future<void> pairFromQr({
    required String qrPayload,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
    bool propagateFailures = false,
  }) async {
    final generation = ++_operationGeneration;
    var stage = 'payload parsing';
    _setState(const Pairing());
    try {
      onDiagnostic?.call('$stage started');
      final bootstrap = PairingBootstrap.parse(qrPayload);
      onDiagnostic?.call(
        'payload parsed: host=${bootstrap.hostId}, endpoints='
        '${bootstrap.endpointCandidates.join(', ')}',
      );
      stage = 'gateway request submission';
      onDiagnostic?.call(
        '$stage started for device-name length '
        '${deviceName.length}',
      );
      final submission = await _client
          .submitPairing(
            bootstrap: bootstrap,
            deviceName: deviceName,
            platform: platform,
            onDiagnostic: onDiagnostic,
          )
          .timeout(
            _submissionTimeout,
            onTimeout: () => throw TimeoutException(
              'Could not send the pairing request through a pinned endpoint '
              'within ${_submissionTimeout.inSeconds}s. Keep Tailscale '
              'connected and generate a fresh pairing code.',
            ),
          );
      if (!_isCurrent(generation)) return;
      onDiagnostic?.call(
        '$stage succeeded: request=${submission.requestId}, '
        'expires=${submission.expiresAt.toUtc().toIso8601String()}',
      );
      _setState(const AwaitingApproval());
      stage = 'desktop approval polling';
      onDiagnostic?.call('$stage started');

      while (DateTime.now().isBefore(submission.expiresAt)) {
        late PairingPoll decision;
        try {
          decision = await _client.pollPairing(
            bootstrap: bootstrap,
            requestId: submission.requestId,
            onDiagnostic: onDiagnostic,
          );
          if (!_isCurrent(generation)) return;
        } on CompanionV1Exception catch (error) {
          if (error.statusCode == 401 ||
              error.statusCode == 403 ||
              error.statusCode == 410) {
            rethrow;
          }
          await Future<void>.delayed(_pollInterval);
          if (!_isCurrent(generation)) return;
          continue;
        } on CompanionCertificateMismatch {
          rethrow;
        } on FormatException {
          rethrow;
        } on Object {
          await Future<void>.delayed(_pollInterval);
          if (!_isCurrent(generation)) return;
          continue;
        }
        if (decision.status == 'approved') {
          final deviceId = decision.deviceId;
          final credential = decision.credential;
          if (deviceId == null || credential == null) {
            throw const FormatException(
              'Approved pairing response omitted its credential.',
            );
          }
          onDiagnostic?.call('desktop approval received');
          final trustRecord = CompanionTrustRecord(
            hostId: bootstrap.hostId,
            certificateSha256: bootstrap.certificateSha256,
            endpointCandidates: bootstrap.endpointCandidates,
            deviceId: deviceId,
            deviceCredential: credential,
          );
          await _storage.save(trustRecord);
          if (!_isCurrent(generation)) return;
          stage = 'paired host connection';
          await _connect(trustRecord, generation);
          if (_state is CertificateMismatch || _state is Revoked) {
            await _storage.forget();
          }
          onDiagnostic?.call('$stage completed with ${_state.runtimeType}');
          return;
        }
        await Future<void>.delayed(_pollInterval);
        if (!_isCurrent(generation)) return;
      }
      if (_isCurrent(generation)) _setState(const Unpaired());
      final error = TimeoutException(
        'Desktop approval was not received before the pairing request expired.',
      );
      onDiagnostic?.call('$stage failed — ${error.runtimeType}: $error');
      if (propagateFailures) throw error;
    } on CompanionCertificateMismatch catch (error, stackTrace) {
      if (!_isCurrent(generation)) return;
      onDiagnostic?.call('$stage failed — ${error.runtimeType}: $error');
      _setState(const CertificateMismatch());
      if (propagateFailures) {
        Error.throwWithStackTrace(error, stackTrace);
      }
    } on CompanionV1Exception catch (error, stackTrace) {
      if (!_isCurrent(generation)) return;
      onDiagnostic?.call('$stage failed — ${error.runtimeType}: $error');
      _setState(switch (error.code) {
        'revoked' => const Revoked(),
        'incompatible_version' => const IncompatibleProtocol(),
        'not_found' when error.statusCode == 410 => const Unpaired(),
        'unauthenticated' when error.statusCode == 403 =>
          const PairingRejected(),
        _ => const PairingUnavailable(),
      });
      if (propagateFailures) {
        Error.throwWithStackTrace(error, stackTrace);
      }
    } on FormatException catch (error, stackTrace) {
      if (!_isCurrent(generation)) return;
      onDiagnostic?.call('$stage failed — ${error.runtimeType}: $error');
      _setState(const Unpaired());
      Error.throwWithStackTrace(error, stackTrace);
    } on Object catch (error, stackTrace) {
      if (!_isCurrent(generation)) return;
      onDiagnostic?.call('$stage failed — ${error.runtimeType}: $error');
      _setState(const PairingUnavailable());
      if (propagateFailures) {
        Error.throwWithStackTrace(error, stackTrace);
      }
    }
  }

  Future<void> _connect(
    CompanionTrustRecord trustRecord,
    int generation,
  ) async {
    var permissionDenied = false;
    var discoveredEndpoints = const <Uri>[];
    try {
      discoveredEndpoints = await _discovery.findTrustedEndpoints(
        trustRecord.hostId,
      );
    } on CompanionDiscoveryPermissionDenied {
      permissionDenied = true;
    } on Object {
      // Discovery is an endpoint hint. Stored candidates remain valid fallbacks.
    }
    if (!_isCurrent(generation)) return;

    final candidates = _mergeEndpoints(
      discoveredEndpoints,
      trustRecord.endpointCandidates,
    );
    final candidateRecord = trustRecord.withEndpointCandidates(candidates);
    try {
      final connection = await _client.fetchHostStatus(candidateRecord);
      if (!_isCurrent(generation)) return;
      final status = connection.status;
      if (status.hostId != trustRecord.hostId) {
        _setState(const CertificateMismatch());
        return;
      }
      if (status.protocolVersion.toString() != companionV1ProtocolVersion) {
        _setState(const IncompatibleProtocol());
        return;
      }
      final updatedRecord = trustRecord.withPreferredEndpoint(
        connection.endpoint,
        trustRecord.endpointCandidates,
      );
      if (updatedRecord != trustRecord) {
        try {
          await _storage.save(updatedRecord);
        } on Object {
          // Endpoint preference is an optimization; trust is already verified.
        }
      }
      if (!_isCurrent(generation)) return;
      _setState(
        Connected(
          hostId: status.hostId,
          protocolVersion: status.protocolVersion,
        ),
      );
    } on CompanionCertificateMismatch {
      if (!_isCurrent(generation)) return;
      _setState(const CertificateMismatch());
    } on CompanionV1Exception catch (error) {
      if (!_isCurrent(generation)) return;
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _setState(const Revoked());
      } else if (error.code == 'incompatible_version') {
        _setState(const IncompatibleProtocol());
      } else {
        _setState(
          permissionDenied
              ? const LocalNetworkPermissionDenied()
              : const Unavailable(),
        );
      }
    } on Object {
      if (!_isCurrent(generation)) return;
      _setState(
        permissionDenied
            ? const LocalNetworkPermissionDenied()
            : const Unavailable(),
      );
    }
  }

  bool _isCurrent(int generation) => generation == _operationGeneration;

  static List<Uri> _mergeEndpoints(List<Uri> preferred, List<Uri> fallbacks) {
    final merged = <Uri>[];
    for (final endpoint in <Uri>[...preferred, ...fallbacks]) {
      if (!merged.contains(endpoint)) merged.add(endpoint);
    }
    return List<Uri>.unmodifiable(merged);
  }

  void _setState(CompanionConnectionState state) {
    if (state is Connected) _lastConnected = state;
    _state = state;
    notifyListeners();
  }
}
