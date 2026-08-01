import 'dart:convert';
import 'dart:io';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

final class _MemorySecureStorage extends FlutterSecureStorage {
  _MemorySecureStorage();

  final Map<String, String> values = <String, String>{};

  @override
  Future<String?> read({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async => values[key];

  @override
  Future<void> write({
    required String key,
    required String? value,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    if (value == null) {
      values.remove(key);
    } else {
      values[key] = value;
    }
  }

  @override
  Future<void> delete({
    required String key,
    AppleOptions? iOptions,
    AndroidOptions? aOptions,
    LinuxOptions? lOptions,
    WebOptions? webOptions,
    AppleOptions? mOptions,
    WindowsOptions? wOptions,
  }) async {
    values.remove(key);
  }
}

void main() {
  test(
    'round-trips host trust and device credentials as one secure record',
    () async {
      final backend = _MemorySecureStorage();
      final storage = PlatformCompanionSecureStorage(storage: backend);
      final record = CompanionTrustRecord(
        hostId: 'host-1',
        certificateSha256: 'AA:BB:CC',
        endpointCandidates: <Uri>[
          Uri.parse('https://192.168.1.20:17424'),
          Uri.parse('https://forge-mac.example.ts.net:17424'),
        ],
        deviceId: 'device-1',
        deviceCredential: 'secret-credential',
      );

      await storage.save(record);

      expect(await storage.load(), record);
      expect(backend.values, hasLength(1));
      final persisted =
          jsonDecode(backend.values.values.single) as Map<String, Object?>;
      expect(
        persisted.keys,
        unorderedEquals(<String>[
          'hostId',
          'certificateSha256',
          'endpointCandidates',
          'deviceId',
          'deviceCredential',
        ]),
      );
      expect(persisted['endpointCandidates'], <String>[
        'https://192.168.1.20:17424',
        'https://forge-mac.example.ts.net:17424',
      ]);
    },
  );

  test('secure persistence schema excludes all Companion domain snapshots', () {
    final persisted = CompanionTrustRecord(
      hostId: 'host-1',
      certificateSha256: 'AA:BB:CC',
      endpointCandidates: <Uri>[Uri.parse('https://openforge.local')],
      deviceId: 'device-1',
      deviceCredential: 'secret-credential',
    ).toJson();

    for (final forbiddenField in <String>[
      'task',
      'tasks',
      'project',
      'projects',
      'agent',
      'agents',
      'handoffNotes',
      'attention',
      'terminal',
      'terminalInput',
      'terminalOutput',
      'terminalReplay',
      'sourceCode',
      'imagePayload',
    ]) {
      expect(persisted, isNot(contains(forbiddenField)));
    }
    expect(jsonEncode(persisted), isNot(contains('Private Handoff Notes')));
  });

  test(
    'terminal implementation has no preferences, file, SQLite, analytics, logging, or secure-storage write sink',
    () {
      final terminalSources = Directory('lib/src/terminal')
          .listSync(recursive: true)
          .whereType<File>()
          .where((file) => file.path.endsWith('.dart'))
          .map((file) => file.readAsStringSync())
          .join('\n');
      final pubspec = File('pubspec.yaml').readAsStringSync();

      for (final forbiddenDependency in <String>[
        'shared_preferences:',
        'sqflite:',
        'sqlite3:',
        'drift:',
        'hive:',
        'isar:',
        'sembast:',
        'path_provider:',
        'firebase_analytics:',
        'sentry_flutter:',
      ]) {
        expect(pubspec, isNot(contains(forbiddenDependency)));
      }
      for (final forbiddenSink in <RegExp>[
        RegExp(r'\bFile\s*\('),
        RegExp(r'\bDirectory\s*\('),
        RegExp(r'\bSharedPreferences\b'),
        RegExp(
          r'\b(?:sqflite|sqlite3|drift|Hive|Isar|Sembast|FirebaseAnalytics|Sentry)\b',
        ),
        RegExp(r'\bFlutterSecureStorage\b'),
        RegExp(r'\bMethodChannel\b'),
        RegExp(r'\.save\s*\('),
        RegExp(r'\.write\s*\(\s*key\s*:'),
        RegExp(r'\b(?:writeAsString|writeAsBytes|openWrite)\s*\('),
        RegExp(r'\b(?:debugPrint|print)\s*\('),
      ]) {
        expect(terminalSources, isNot(matches(forbiddenSink)));
      }
    },
  );

  test('forget removes the complete persisted trust record', () async {
    final backend = _MemorySecureStorage();
    final storage = PlatformCompanionSecureStorage(storage: backend);
    await storage.save(
      CompanionTrustRecord(
        hostId: 'host-1',
        certificateSha256: 'AA:BB:CC',
        endpointCandidates: <Uri>[Uri.parse('https://openforge.local')],
        deviceId: 'device-1',
        deviceCredential: 'secret-credential',
      ),
    );

    await storage.forget();

    expect(await storage.load(), isNull);
  });

  test('preferred endpoint history is deduplicated and bounded', () {
    final record = CompanionTrustRecord(
      hostId: 'host-1',
      certificateSha256: 'AA:BB:CC',
      endpointCandidates: List<Uri>.generate(
        12,
        (index) => Uri.parse('https://192.168.1.${index + 1}:17424'),
      ),
      deviceId: 'device-1',
      deviceCredential: 'secret-credential',
    );
    final preferred = Uri.parse('https://192.168.1.99:17424');

    final updated = record.withPreferredEndpoint(
      preferred,
      record.endpointCandidates,
    );

    expect(updated.endpointCandidates.first, preferred);
    expect(
      updated.endpointCandidates,
      hasLength(CompanionTrustRecord.maxPersistedEndpointCandidates),
    );
    expect(updated.endpointCandidates.toSet(), hasLength(8));
  });
}
