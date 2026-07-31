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
        endpointCandidates: <Uri>[Uri.parse('https://openforge.local:17423')],
        deviceId: 'device-1',
        deviceCredential: 'secret-credential',
      );

      await storage.save(record);

      expect(await storage.load(), record);
      expect(backend.values, hasLength(1));
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
}
