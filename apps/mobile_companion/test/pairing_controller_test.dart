import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/discovery/companion_discovery.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/pairing_bootstrap.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';

const _hostId = '65d91f21-6732-45a6-9418-3dfaf4c93f52';
const _fingerprint =
    '9F:64:A7:47:E1:B9:7F:13:1F:AB:B6:B4:47:29:6C:9B:6F:02:01:E7:9F:B3:C5:35:6E:6C:77:E8:9B:6A:80:6A';
const _secret = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';

String get _qrPayload =>
    '{"protocolVersion":3,"hostId":"$_hostId",'
    '"certificateSha256":"$_fingerprint",'
    '"endpointCandidates":["https://192.168.1.20:17424"],'
    '"oneTimeSecret":"$_secret"}';

final class _FakeClient implements CompanionClient {
  @override
  Future<TaskCreateResult> createTask(
    CompanionTrustRecord trustRecord,
    String projectId,
    String initialPrompt,
  ) => throw UnsupportedError('not used');

  @override
  Future<TaskPromptCatalog> fetchTaskPromptCatalog(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) => throw UnsupportedError('not used');

  @override
  Future<TaskDeleteReceipt> deleteBacklogTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
  Object? submitError;
  Completer<PairingSubmissionStatus>? submitCompleter;
  Object? pollError;
  final pollErrors = <Object>[];
  Object? hostStatusError;
  Completer<CompanionHostConnection>? hostStatusCompleter;
  PairingPoll poll = const PairingPoll(
    status: 'approved',
    deviceId: 'device-1',
    credential: 'credential-1',
  );
  HostStatus hostStatus = HostStatus(
    hostId: _hostId,
    protocolVersion: 3,
    serverTime: DateTime.utc(2026, 7, 30),
  );
  String? submittedDeviceName;
  String? submittedPlatform;
  CompanionTrustRecord? fetchedTrustRecord;
  Uri? connectedEndpoint;

  @override
  Future<PairingSubmissionStatus> submitPairing({
    required PairingBootstrap bootstrap,
    required String deviceName,
    required String platform,
    CompanionPairingDiagnostic? onDiagnostic,
  }) async {
    final error = submitError;
    if (error != null) throw error;
    final completer = submitCompleter;
    if (completer != null) return await completer.future;
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
    CompanionPairingDiagnostic? onDiagnostic,
  }) async {
    if (pollErrors.isNotEmpty) throw pollErrors.removeAt(0);
    final error = pollError;
    if (error != null) throw error;
    return poll;
  }

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async {
    fetchedTrustRecord = trustRecord;
    final error = hostStatusError;
    if (error != null) throw error;
    final completer = hostStatusCompleter;
    if (completer != null) return completer.future;
    return CompanionHostConnection(
      endpoint: connectedEndpoint ?? trustRecord.endpointCandidates.first,
      status: hostStatus,
    );
  }

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) => throw UnsupportedError('not used');

  @override
  Future<AttentionSnapshot> fetchAttention(
    CompanionTrustRecord trustRecord,
  ) async => AttentionSnapshot(
    snapshotAt: DateTime.utc(2026, 7, 30),
    items: const <AttentionItem>[],
  );

  @override
  Future<ProjectCatalog> fetchProjectCatalog(
    CompanionTrustRecord trustRecord,
  ) => throw UnsupportedError('not used');

  @override
  Future<ProjectBoard> fetchProjectBoard(
    CompanionTrustRecord trustRecord,
    String projectId,
  ) => throw UnsupportedError('not used');
  @override
  Future<TaskDetail> fetchTaskDetail(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');

  @override
  Future<TaskStartResult> startTask(
    CompanionTrustRecord trustRecord,
    String taskId,
  ) => throw UnsupportedError('not used');
}

final class _FakeDiscovery implements CompanionEndpointDiscovery {
  List<Uri> endpoints = const <Uri>[];
  Object? error;
  var settingsCalls = 0;

  @override
  Future<List<Uri>> findTrustedEndpoints(String hostId) async {
    final discoveryError = error;
    if (discoveryError != null) throw discoveryError;
    return endpoints;
  }

  @override
  Future<void> openSettings() async {
    settingsCalls += 1;
  }
}

final class _FakeStorage implements CompanionSecureStorage {
  CompanionTrustRecord? record;
  Object? loadError;
  Object? saveError;
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
    final error = saveError;
    if (error != null) throw error;
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
      expect(connected.protocolVersion, 3);
    },
  );

  test('pairing submission deadline surfaces an actionable failure', () async {
    final client = _FakeClient()
      ..submitCompleter = Completer<PairingSubmissionStatus>();
    final controller = CompanionPairingController(
      client: client,
      storage: _FakeStorage(),
      pollInterval: Duration.zero,
      submissionTimeout: const Duration(milliseconds: 10),
    );
    final diagnostics = <String>[];

    await expectLater(
      controller.pairFromQr(
        qrPayload: _qrPayload,
        deviceName: 'Pixel 9',
        platform: 'android',
        onDiagnostic: diagnostics.add,
        propagateFailures: true,
      ),
      throwsA(
        isA<TimeoutException>().having(
          (error) => error.message,
          'message',
          allOf(
            contains('pinned endpoint'),
            contains('Keep Tailscale connected'),
          ),
        ),
      ),
    );

    expect(controller.state, isA<PairingUnavailable>());
    expect(
      diagnostics.join('\n'),
      allOf(
        contains('gateway request submission started'),
        contains('gateway request submission failed'),
        isNot(contains(_secret)),
      ),
    );
  });

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
          protocolVersion: 3,
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

  test(
    'gateway stream closure preserves trust for disable and later re-enable',
    () async {
      final client = _FakeClient();
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
      expect(controller.state, isA<Connected>());

      controller.gatewayClosing();
      expect(controller.state, isA<Reconnecting>());
      expect(storage.record, isNotNull);

      client.hostStatusError = const SocketException('gateway disabled');
      await controller.restore();
      expect(controller.state, isA<Unavailable>());
      expect(storage.record, isNotNull);

      client.hostStatusError = null;
      await controller.restore();
      expect(controller.state, isA<Connected>());
      expect(storage.record?.deviceId, 'device-1');
    },
  );

  test('authorization termination enters re-pair required', () async {
    final controller = CompanionPairingController(
      client: _FakeClient(),
      storage: _FakeStorage(),
    );

    controller.authorizationLost();

    expect(controller.state, isA<Revoked>());
  });

  test('authorization termination wins over an in-flight restore', () async {
    final pendingStatus = Completer<CompanionHostConnection>();
    final client = _FakeClient()..hostStatusCompleter = pendingStatus;
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
    final restore = controller.restore();
    await Future<void>.delayed(Duration.zero);

    controller.authorizationLost();
    pendingStatus.complete(
      CompanionHostConnection(
        endpoint: storage.record!.endpointCandidates.first,
        status: client.hostStatus,
      ),
    );
    await restore;

    expect(controller.state, isA<Revoked>());
  });

  test(
    'authorization termination wins over an in-flight paired connection',
    () async {
      final pendingStatus = Completer<CompanionHostConnection>();
      final client = _FakeClient()..hostStatusCompleter = pendingStatus;
      final storage = _FakeStorage();
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        pollInterval: Duration.zero,
      );
      final pairing = controller.pairFromQr(
        qrPayload: _qrPayload,
        deviceName: 'Pixel 9',
        platform: 'android',
      );
      while (client.fetchedTrustRecord == null) {
        await Future<void>.delayed(Duration.zero);
      }

      controller.authorizationLost();
      pendingStatus.complete(
        CompanionHostConnection(
          endpoint: client.fetchedTrustRecord!.endpointCandidates.first,
          status: client.hostStatus,
        ),
      );
      await pairing;

      expect(controller.state, isA<Revoked>());
      expect(storage.record, isNull);
    },
  );

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

  test(
    'discovered DHCP endpoint is preferred, verified, and persisted without re-pairing',
    () async {
      final oldEndpoint = Uri.parse('https://192.168.1.20:17424');
      final newEndpoint = Uri.parse('https://192.168.1.40:17424');
      final fallbackEndpoint = Uri.parse('https://192.168.1.41:17424');
      final discovery = _FakeDiscovery()
        ..endpoints = <Uri>[newEndpoint, fallbackEndpoint];
      final client = _FakeClient()..connectedEndpoint = fallbackEndpoint;
      final storage = _FakeStorage()
        ..record = CompanionTrustRecord(
          hostId: _hostId,
          certificateSha256: _fingerprint,
          endpointCandidates: <Uri>[oldEndpoint],
          deviceId: 'device-1',
          deviceCredential: 'credential-1',
        );
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        discovery: discovery,
      );

      await controller.restore();

      expect(controller.state, isA<Connected>());
      expect(client.fetchedTrustRecord?.endpointCandidates, <Uri>[
        newEndpoint,
        fallbackEndpoint,
        oldEndpoint,
      ]);
      expect(storage.record?.endpointCandidates, <Uri>[
        fallbackEndpoint,
        oldEndpoint,
      ]);
      expect(storage.record?.endpointCandidates, isNot(contains(newEndpoint)));
      expect(storage.record?.deviceCredential, 'credential-1');
    },
  );

  test(
    'verified failover stays connected when endpoint persistence fails',
    () async {
      final oldEndpoint = Uri.parse('https://192.168.1.20:17424');
      final newEndpoint = Uri.parse('https://192.168.1.40:17424');
      final discovery = _FakeDiscovery()..endpoints = <Uri>[newEndpoint];
      final client = _FakeClient()..connectedEndpoint = newEndpoint;
      final storage = _FakeStorage()
        ..record = CompanionTrustRecord(
          hostId: _hostId,
          certificateSha256: _fingerprint,
          endpointCandidates: <Uri>[oldEndpoint],
          deviceId: 'device-1',
          deviceCredential: 'credential-1',
        )
        ..saveError = const FileSystemException('secure storage unavailable');
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
        discovery: discovery,
      );

      await controller.restore();

      expect(controller.state, isA<Connected>());
      expect(storage.saveCalls, 1);
      expect(storage.record?.endpointCandidates, <Uri>[oldEndpoint]);
    },
  );

  test(
    'MagicDNS failure maps to the existing desktop unavailable state',
    () async {
      final client = _FakeClient()
        ..hostStatusError = const SocketException('Failed host lookup');
      final storage = _FakeStorage()
        ..record = CompanionTrustRecord(
          hostId: _hostId,
          certificateSha256: _fingerprint,
          endpointCandidates: <Uri>[
            Uri.parse('https://forge-mac.example.ts.net:17424'),
          ],
          deviceId: 'device-1',
          deviceCredential: 'credential-1',
        );
      final controller = CompanionPairingController(
        client: client,
        storage: storage,
      );

      await controller.restore();

      expect(controller.state, isA<Unavailable>());
      expect(storage.record?.deviceCredential, 'credential-1');
    },
  );

  test(
    'permission denial has typed recovery after stored endpoints fail',
    () async {
      final discovery = _FakeDiscovery()
        ..error = const CompanionDiscoveryPermissionDenied();
      final client = _FakeClient()
        ..hostStatusError = const SocketException('unreachable');
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
        discovery: discovery,
      );

      await controller.restore();
      expect(controller.state, isA<LocalNetworkPermissionDenied>());

      await controller.openLocalNetworkSettings();
      expect(discovery.settingsCalls, 1);

      discovery.error = null;
      client.hostStatusError = null;
      await controller.restore();
      expect(controller.state, isA<Connected>());
    },
  );

  test('mismatched discovered certificate remains a security state', () async {
    final discovery = _FakeDiscovery()
      ..endpoints = <Uri>[Uri.parse('https://192.168.1.40:17424')];
    final client = _FakeClient()
      ..hostStatusError = const CompanionCertificateMismatch();
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
      discovery: discovery,
    );

    await controller.restore();

    expect(controller.state, isA<CertificateMismatch>());
    expect(storage.record?.deviceCredential, 'credential-1');
  });

  test('domain authorization loss enters the re-pair-required state', () {
    final controller = CompanionPairingController(
      client: _FakeClient(),
      storage: _FakeStorage(),
    );

    controller.authorizationLost();

    expect(controller.state, isA<Revoked>());
  });
}
