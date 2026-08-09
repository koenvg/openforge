import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

final class CompanionTrustRecord {
  CompanionTrustRecord({
    required this.hostId,
    required this.certificateSha256,
    required List<Uri> endpointCandidates,
    required this.deviceId,
    required this.deviceCredential,
  }) : endpointCandidates = List<Uri>.unmodifiable(endpointCandidates);

  factory CompanionTrustRecord.fromJson(Map<String, Object?> json) {
    final hostId = json['hostId'];
    final certificateSha256 = json['certificateSha256'];
    final endpoints = json['endpointCandidates'];
    final deviceId = json['deviceId'];
    final deviceCredential = json['deviceCredential'];

    if (hostId is! String ||
        certificateSha256 is! String ||
        endpoints is! List<Object?> ||
        deviceId is! String ||
        deviceCredential is! String ||
        endpoints.any((endpoint) => endpoint is! String)) {
      throw const FormatException('Invalid companion trust record.');
    }

    return CompanionTrustRecord(
      hostId: hostId,
      certificateSha256: certificateSha256,
      endpointCandidates: endpoints
          .cast<String>()
          .map(Uri.parse)
          .toList(growable: false),
      deviceId: deviceId,
      deviceCredential: deviceCredential,
    );
  }

  final String hostId;
  final String certificateSha256;
  final List<Uri> endpointCandidates;
  final String deviceId;
  final String deviceCredential;

  static const maxPersistedEndpointCandidates = 8;

  CompanionTrustRecord withEndpointCandidates(List<Uri> endpoints) =>
      CompanionTrustRecord(
        hostId: hostId,
        certificateSha256: certificateSha256,
        endpointCandidates: endpoints,
        deviceId: deviceId,
        deviceCredential: deviceCredential,
      );

  CompanionTrustRecord withPreferredEndpoint(
    Uri preferred,
    List<Uri> candidates,
  ) {
    final ordered = <Uri>[preferred];
    for (final candidate in candidates) {
      if (!ordered.contains(candidate)) ordered.add(candidate);
      if (ordered.length == maxPersistedEndpointCandidates) break;
    }
    return withEndpointCandidates(ordered);
  }

  Map<String, Object> toJson() => <String, Object>{
    'hostId': hostId,
    'certificateSha256': certificateSha256,
    'endpointCandidates': endpointCandidates
        .map((endpoint) => endpoint.toString())
        .toList(growable: false),
    'deviceId': deviceId,
    'deviceCredential': deviceCredential,
  };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is CompanionTrustRecord &&
          hostId == other.hostId &&
          certificateSha256 == other.certificateSha256 &&
          deviceId == other.deviceId &&
          deviceCredential == other.deviceCredential &&
          _urisEqual(endpointCandidates, other.endpointCandidates);

  @override
  int get hashCode => Object.hash(
    hostId,
    certificateSha256,
    deviceId,
    deviceCredential,
    Object.hashAll(endpointCandidates),
  );

  static bool _urisEqual(List<Uri> left, List<Uri> right) {
    if (left.length != right.length) return false;
    for (var index = 0; index < left.length; index += 1) {
      if (left[index] != right[index]) return false;
    }
    return true;
  }
}

abstract interface class CompanionSecureStorage {
  Future<CompanionTrustRecord?> load();

  Future<void> save(CompanionTrustRecord record);

  Future<void> forget();
}

abstract interface class SelectedProjectStorage {
  Future<String?> loadSelectedProject(String hostId);

  Future<void> saveSelectedProject(String hostId, String projectId);

  Future<void> clearSelectedProject(String hostId);
}

abstract interface class CompanionProjectStorage
    implements CompanionSecureStorage, SelectedProjectStorage {}

/// Persists the complete host trust and device credential record through
/// Keychain on iOS and Android Keystore-backed encrypted storage on Android.
final class PlatformCompanionSecureStorage implements CompanionProjectStorage {
  PlatformCompanionSecureStorage({FlutterSecureStorage? storage})
    : _storage = storage ?? _platformStorage;

  static const _recordKey = 'companion.host_trust.v1';
  static const _selectedProjectKey = 'companion.selected_project.v1';
  static const _platformStorage = FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.unlocked_this_device,
    ),
    aOptions: AndroidOptions(storageNamespace: 'openforge_companion'),
  );

  final FlutterSecureStorage _storage;
  Future<void> _selectionWrites = Future<void>.value();

  @override
  Future<CompanionTrustRecord?> load() async {
    final encoded = await _storage.read(key: _recordKey);
    if (encoded == null) return null;

    final decoded = jsonDecode(encoded);
    if (decoded is! Map<String, Object?>) {
      throw const FormatException('Invalid companion trust record.');
    }
    return CompanionTrustRecord.fromJson(decoded);
  }

  @override
  Future<void> save(CompanionTrustRecord record) =>
      _storage.write(key: _recordKey, value: jsonEncode(record.toJson()));

  @override
  Future<void> forget() async {
    await _storage.delete(key: _recordKey);
    await _enqueueSelectionWrite(
      () => _storage.delete(key: _selectedProjectKey),
    );
  }

  @override
  Future<String?> loadSelectedProject(String hostId) async {
    await _selectionWrites;
    final encoded = await _storage.read(key: _selectedProjectKey);
    if (encoded == null) return null;
    try {
      final decoded = jsonDecode(encoded);
      if (decoded is! Map<String, Object?> ||
          decoded['hostId'] is! String ||
          decoded['projectId'] is! String) {
        throw const FormatException('Invalid Selected Project record.');
      }
      return decoded['hostId'] == hostId
          ? decoded['projectId']! as String
          : null;
    } on Object {
      await _enqueueSelectionWrite(
        () => _storage.delete(key: _selectedProjectKey),
      );
      return null;
    }
  }

  @override
  Future<void> saveSelectedProject(String hostId, String projectId) =>
      _enqueueSelectionWrite(() async {
        final trustRecord = await _storage.read(key: _recordKey);
        if (_hostIdFromTrustRecord(trustRecord) != hostId) return;
        await _storage.write(
          key: _selectedProjectKey,
          value: jsonEncode(<String, String>{
            'hostId': hostId,
            'projectId': projectId,
          }),
        );
      });

  @override
  Future<void> clearSelectedProject(String hostId) =>
      _enqueueSelectionWrite(() async {
        final encoded = await _storage.read(key: _selectedProjectKey);
        if (encoded == null) return;
        try {
          final decoded = jsonDecode(encoded);
          if (decoded is! Map<String, Object?> ||
              decoded['hostId'] is! String ||
              decoded['projectId'] is! String) {
            await _storage.delete(key: _selectedProjectKey);
            return;
          }
          if (decoded['hostId'] == hostId) {
            await _storage.delete(key: _selectedProjectKey);
          }
        } on Object {
          await _storage.delete(key: _selectedProjectKey);
        }
      });

  Future<void> _enqueueSelectionWrite(Future<void> Function() write) {
    final result = _selectionWrites.then((_) => write());
    _selectionWrites = result.then<void>(
      (_) {},
      onError: (Object _, StackTrace _) {},
    );
    return result;
  }

  String? _hostIdFromTrustRecord(String? encoded) {
    if (encoded == null) return null;
    try {
      final decoded = jsonDecode(encoded);
      return decoded is Map<String, Object?> && decoded['hostId'] is String
          ? decoded['hostId']! as String
          : null;
    } on Object {
      return null;
    }
  }
}
