import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/discovery/bonjour_discovery_browser.dart';
import 'package:openforge_companion/src/discovery/companion_discovery.dart';

const _trustedHostId = '65d91f21-6732-45a6-9418-3dfaf4c93f52';

final class _FakeDiscoveryBrowser implements CompanionDiscoveryBrowser {
  List<DiscoveredCompanionService> services = const [];
  Object? error;
  var settingsCalls = 0;
  String? requestedType;

  @override
  Future<List<DiscoveredCompanionService>> browse({
    required String serviceType,
    required Duration timeout,
  }) async {
    requestedType = serviceType;
    final browseError = error;
    if (browseError != null) throw browseError;
    return services;
  }

  @override
  Future<void> openSettings() async {
    settingsCalls += 1;
  }
}

void main() {
  test(
    'discovery selects every address only for the already paired host',
    () async {
      final browser = _FakeDiscoveryBrowser()
        ..services = const <DiscoveredCompanionService>[
          DiscoveredCompanionService(
            attributes: <String, String>{
              'hostId': 'different-host',
              'protocolVersion': '1',
            },
            hostAddresses: <String>['192.168.1.10'],
            port: 17424,
          ),
          DiscoveredCompanionService(
            attributes: <String, String>{
              'hostId': _trustedHostId,
              'protocolVersion': '1',
            },
            hostAddresses: <String>['192.168.1.20', 'fe80::1234'],
            port: 17424,
          ),
        ];
      final discovery = TrustedCompanionEndpointDiscovery(browser: browser);

      final endpoints = await discovery.findTrustedEndpoints(_trustedHostId);

      expect(browser.requestedType, companionBonjourServiceType);
      expect(endpoints, <Uri>[
        Uri.parse('https://192.168.1.20:17424'),
        Uri.parse('https://[fe80::1234]:17424'),
      ]);
    },
  );

  test(
    'permission denial is typed and settings recovery is delegated',
    () async {
      final browser = _FakeDiscoveryBrowser()
        ..error = const CompanionDiscoveryPermissionDenied();
      final discovery = TrustedCompanionEndpointDiscovery(browser: browser);

      await expectLater(
        discovery.findTrustedEndpoints(_trustedHostId),
        throwsA(isA<CompanionDiscoveryPermissionDenied>()),
      );
      await discovery.openSettings();

      expect(browser.settingsCalls, 1);
    },
  );

  test(
    'Bonjour permission errors are mapped without hiding other failures',
    () {
      expect(
        isCompanionDiscoveryPermissionError(
          PlatformException(code: 'discoveryError', details: -65570),
        ),
        isTrue,
      );
      expect(
        isCompanionDiscoveryPermissionError(
          PlatformException(code: 'discoveryError', details: 7),
        ),
        isTrue,
      );
      expect(
        isCompanionDiscoveryPermissionError(
          PlatformException(
            code: 'discoveryError',
            message: 'kDNSServiceErr_PolicyDenied',
          ),
        ),
        isTrue,
      );
      expect(
        isCompanionDiscoveryPermissionError(
          PlatformException(code: 'discoveryError', details: 0),
        ),
        isFalse,
      );
    },
  );
}
