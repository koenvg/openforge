import 'package:flutter/foundation.dart';

import '../client/companion_client.dart';
import '../client/pinned_companion_transport.dart';
import '../connection/companion_connection_state.dart';
import '../generated/companion_v1_client.dart';
import '../storage/companion_secure_storage.dart';
import 'pairing_bootstrap.dart';

final class CompanionPairingController extends ChangeNotifier {
  factory CompanionPairingController({
    required CompanionClient client,
    required CompanionSecureStorage storage,
    Duration pollInterval = const Duration(seconds: 1),
  }) => CompanionPairingController._(client, storage, pollInterval);

  CompanionPairingController._(this._client, this._storage, this._pollInterval);

  final CompanionClient _client;
  final CompanionSecureStorage _storage;
  final Duration _pollInterval;

  CompanionConnectionState _state = const Restoring();
  CompanionConnectionState get state => _state;

  Future<void> restore() async {
    _setState(const Restoring());
    try {
      final trustRecord = await _storage.load();
      if (trustRecord == null) {
        _setState(const Unpaired());
        return;
      }
      await _connect(trustRecord);
    } on FormatException {
      try {
        await _storage.forget();
        _setState(const Unpaired());
      } on Object {
        _setState(const Unavailable());
      }
    } on Object {
      _setState(const Unavailable());
    }
  }

  void authorizationLost() => _setState(const Revoked());

  Future<void> forgetAndReset() async {
    await _storage.forget();
    _setState(const Unpaired());
  }

  Future<void> pairFromQr({
    required String qrPayload,
    required String deviceName,
    required String platform,
  }) async {
    _setState(const Pairing());
    try {
      final bootstrap = PairingBootstrap.parse(qrPayload);
      final submission = await _client.submitPairing(
        bootstrap: bootstrap,
        deviceName: deviceName,
        platform: platform,
      );
      _setState(const AwaitingApproval());

      while (DateTime.now().isBefore(submission.expiresAt)) {
        late PairingPoll decision;
        try {
          decision = await _client.pollPairing(
            bootstrap: bootstrap,
            requestId: submission.requestId,
          );
        } on CompanionV1Exception catch (error) {
          if (error.statusCode == 401 ||
              error.statusCode == 403 ||
              error.statusCode == 410) {
            rethrow;
          }
          await Future<void>.delayed(_pollInterval);
          continue;
        } on CompanionCertificateMismatch {
          rethrow;
        } on FormatException {
          rethrow;
        } on Object {
          await Future<void>.delayed(_pollInterval);
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
          final trustRecord = CompanionTrustRecord(
            hostId: bootstrap.hostId,
            certificateSha256: bootstrap.certificateSha256,
            endpointCandidates: bootstrap.endpointCandidates,
            deviceId: deviceId,
            deviceCredential: credential,
          );
          await _storage.save(trustRecord);
          await _connect(trustRecord);
          if (_state is CertificateMismatch || _state is Revoked) {
            await _storage.forget();
          }
          return;
        }
        await Future<void>.delayed(_pollInterval);
      }
      _setState(const Unpaired());
    } on CompanionCertificateMismatch {
      _setState(const CertificateMismatch());
    } on CompanionV1Exception catch (error) {
      _setState(switch (error.code) {
        'revoked' => const Revoked(),
        'incompatible_version' => const IncompatibleProtocol(),
        'not_found' when error.statusCode == 410 => const Unpaired(),
        'unauthenticated' when error.statusCode == 403 =>
          const PairingRejected(),
        _ => const PairingUnavailable(),
      });
    } on FormatException {
      _setState(const Unpaired());
      rethrow;
    } on Object {
      _setState(const PairingUnavailable());
    }
  }

  Future<void> _connect(CompanionTrustRecord trustRecord) async {
    try {
      final status = await _client.fetchHostStatus(trustRecord);
      if (status.hostId != trustRecord.hostId) {
        _setState(const CertificateMismatch());
        return;
      }
      if (status.protocolVersion != 1) {
        _setState(const IncompatibleProtocol());
        return;
      }
      _setState(
        Connected(
          hostId: status.hostId,
          protocolVersion: status.protocolVersion,
        ),
      );
    } on CompanionCertificateMismatch {
      _setState(const CertificateMismatch());
    } on CompanionV1Exception catch (error) {
      if (error.code == 'revoked' || error.code == 'unauthenticated') {
        _setState(const Revoked());
      } else if (error.code == 'incompatible_version') {
        _setState(const IncompatibleProtocol());
      } else {
        _setState(const Unavailable());
      }
    } on Object {
      _setState(const Unavailable());
    }
  }

  void _setState(CompanionConnectionState state) {
    _state = state;
    notifyListeners();
  }
}
