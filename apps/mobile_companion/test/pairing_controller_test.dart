import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

const _hostId = '65d91f21-6732-45a6-9418-3dfaf4c93f52';
const _fingerprint =
    '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A';
const _secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

String get _qrPayload =>
    '{"protocolVersion":1,"hostId":"$_hostId",'
    '"certificateSha256":"$_fingerprint",'
    '"endpointCandidates":["https://192.168.1.20:17424"],'
    '"oneTimeSecret":"$_secret"}';

final class _FakeClient implements CompanionClient {
  Object? submitError;
  Object? pollError;
  final pollErrors = <Object>[];
  Object? hostStatusError;
  PairingPoll poll = const PairingPoll(
    status: 'approved',
    deviceId: 'device-1',
    credential: 'credential-1',
  );
  HostStatus hostStatus = HostStatus(
    hostId: _hostId,
    protocolVersion: 1,
    serverTime: DateTime.utc(2026, 7, 30),
  );
  String? submittedDeviceName;
  String? submittedPlatform;

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
  }) async {
    final error = submitError;
    if (error != null) throw error;
    submittedDeviceName = deviceName;
    submittedPlatform = platform;
    return PairingSubmissionStatus(
      requestId: 'request-1',
      status: 'pending',
      expiresAt: DateTime.now().add(const Duration(minutes: 1)),
    );
  }

  @override
  Future<PairingPoll> pollPairing({
    required PairingBootstrap bootstrap,
    required String requestId,
  }) async {
    if (pollErrors.isNotEmpty) throw pollErrors.removeAt(0);
    final error = pollError;
    if (error != null) throw error;
    return poll;
  }

  @override
  Future<HostStatus> fetchHostStatus(CompanionTrustRecord trustRecord) async {
    final error = hostStatusError;
    if (error != null) throw error;
    return hostStatus;
  }
}

final class _FakeStorage implements CompanionSecureStorage {
  CompanionTrustRecord? record;
  Object? loadError;
  var saveCalls = 0;
  var forgetCalls = 0;

  @override
  Future<void> forget() async {
    forgetCalls += 1;
    record = null;
  }

  @override
  Future<CompanionTrustRecord?> load() async {
    final error = loadError;
    if (error != null) throw error;
    return record;
  }

  @override
  Future<void> save(CompanionTrustRecord value) async {
    saveCalls += 1;
    record = value;
  }
}

void main() {
  test(
    'approval stores one credential and connects through generated status',
    () async {
      final client = _FakeClient();
      final storage = _FakeStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final states = <Type>[];
      controller.addListener(() => states.add(controller.state.runtimeType));

      await controller.pairFromQr(
        qrPayload: _qrPayload,
        deviceName: "Koen's iPhone",
        platform: 'ios',
      );

      expect(
        states,
        containsAllInOrder(<Type>[Pairing, AwaitingApproval, Connected]),
      );
      expect(client.submittedDeviceName, "Koen's iPhone");
      expect(client.submittedPlatform, 'ios');
      expect(storage.saveCalls, 1);
      expect(storage.record?.deviceId, 'device-1');
      expect(storage.record?.deviceCredential, 'credential-1');
      final connected = controller.state as Connected;
      expect(connected.hostId, _hostId);
      expect(connected.protocolVersion, 1);
    },
  );

  test('transient poll failure keeps the original claimable request', () async {
    final client = _FakeClient()
      ..pollErrors.add(
        const CompanionV1Exception(
          statusCode: 503,
          code: 'temporarily_unavailable',
          message: 'Try again',
        ),
      );
    final storage = _FakeStorage();
    final controller = CompanionPairingController(
      client: client,
      storage: storage,
      pollInterval: Duration.zero,
    );

    await controller.pairFromQr(
      qrPayload: _qrPayload,
      deviceName: 'Pixel 9',
      platform: 'android',
    );

    expect(controller.state, isA<Connected>());
    expect(storage.saveCalls, 1);
  });

  test(
    'desktop rejection stores no trust material and shows rejected',
    () async {
      final client = _FakeClient()
        ..pollError = const CompanionV1Exception(
          statusCode: 403,
          code: 'unauthenticated',
          message: 'Pairing request was rejected',
        );
      final storage = _FakeStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );

      await controller.pairFromQr(
        qrPayload: _qrPayload,
        deviceName: 'Pixel 9',
        platform: 'android',
      );

      expect(controller.state, isA<PairingRejected>());
      expect(storage.saveCalls, 0);
      expect(storage.record, isNull);
    },
  );

  test(
    'certificate mismatch is terminal and stores no trust material',
    () async {
      final client = _FakeClient()
        ..submitError = const CompanionCertificateMismatch();
      final storage = _FakeStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
      );

      await controller.pairFromQr(
        qrPayload: _qrPayload,
        deviceName: 'Pixel 9',
        platform: 'android',
      );

      expect(controller.state, isA<CertificateMismatch>());
      expect(storage.saveCalls, 0);
    },
  );

  test(
    'first status identity mismatch discards the newly issued trust',
    () async {
      final client = _FakeClient()
        ..hostStatus = HostStatus(
          hostId: 'different-host',
          protocolVersion: 1,
          serverTime: DateTime.utc(2026, 7, 30),
        );
      final storage = _FakeStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );

      await controller.pairFromQr(
        qrPayload: _qrPayload,
        deviceName: 'Pixel 9',
        platform: 'android',
      );

      expect(controller.state, isA<CertificateMismatch>());
      expect(storage.saveCalls, 1);
      expect(storage.forgetCalls, 1);
      expect(storage.record, isNull);
    },
  );

  test('revoked stored trust can be forgotten before re-pairing', () async {
    final client = _FakeClient()
      ..hostStatusError = const CompanionV1Exception(
        statusCode: 401,
        code: 'revoked',
        message: 'Device was revoked',
      );
    final storage = _FakeStorage()
      ..record = CompanionTrustRecord(
        hostId: _hostId,
        certificateSha256: _fingerprint,
        endpointCandidates: <Uri>[Uri.parse('https://192.168.1.20:17424')],
        deviceId: 'device-1',
        deviceCredential: 'credential-1',
      );
    final controller = CompanionPairingController(
      client: client,
      storage: storage,
    );

    await controller.restore();
    expect(controller.state, isA<Revoked>());

    await controller.forgetAndReset();
    expect(controller.state, isA<Unpaired>());
    expect(storage.record, isNull);
  });

  test('corrupt secure storage is forgotten and returns to unpaired', () async {
    final storage = _FakeStorage()
      ..loadError = const FormatException('corrupt trust record');
    final controller = CompanionPairingController(
      client: _FakeClient(),
      storage: storage,
    );

    await controller.restore();

    expect(controller.state, isA<Unpaired>());
    expect(storage.forgetCalls, 1);
  });

  test('expired pairing can immediately start over', () async {
    final client = _FakeClient()
      ..pollError = const CompanionV1Exception(
        statusCode: 410,
        code: 'not_found',
        message: 'Pairing session expired',
      );
    final controller = CompanionPairingController(
      client: client,
      storage: _FakeStorage(),
    );

    await controller.pairFromQr(
      qrPayload: _qrPayload,
      deviceName: 'Pixel 9',
      platform: 'android',
    );

    expect(controller.state, isA<Unpaired>());
  });
}
