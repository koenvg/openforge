import '../generated/companion_v1_client.dart';

const companionBonjourServiceType = '_openforge._tcp';

final class CompanionDiscoveryPermissionDenied implements Exception {
  const CompanionDiscoveryPermissionDenied();
}

final class DiscoveredCompanionService {
  const DiscoveredCompanionService({
    required this.attributes,
    required this.hostAddresses,
    required this.port,
  });

  final Map<String, String> attributes;
  final List<String> hostAddresses;
  final int port;
}

abstract interface class CompanionDiscoveryBrowser {
  Future<List<DiscoveredCompanionService>> browse({
    required String serviceType,
    required Duration timeout,
  });

  Future<void> openSettings();
}

abstract interface class CompanionEndpointDiscovery {
  Future<List<Uri>> findTrustedEndpoints(String hostId);

  Future<void> openSettings();
}

final class TrustedCompanionEndpointDiscovery
    implements CompanionEndpointDiscovery {
  const TrustedCompanionEndpointDiscovery({
    required this.browser,
    this.browseDuration = const Duration(seconds: 2),
  });

  final CompanionDiscoveryBrowser browser;
  final Duration browseDuration;

  @override
  Future<List<Uri>> findTrustedEndpoints(String hostId) async {
    final services = await browser.browse(
      serviceType: companionBonjourServiceType,
      timeout: browseDuration,
    );
    final endpoints = <Uri>[];
    final seen = <Uri>{};
    for (final service in services) {
      if (service.attributes['hostId'] != hostId ||
          service.attributes['protocolVersion'] != companionV1ProtocolVersion ||
          service.port < 1 ||
          service.port > 65535) {
        continue;
      }
      for (final address in service.hostAddresses) {
        final endpoint = _httpsEndpoint(address, service.port);
        if (endpoint != null && seen.add(endpoint)) endpoints.add(endpoint);
      }
    }
    return List<Uri>.unmodifiable(endpoints);
  }

  @override
  Future<void> openSettings() => browser.openSettings();

  static Uri? _httpsEndpoint(String address, int port) {
    final normalizedAddress = address.split('%').first;
    final parsedAddress = Uri.tryParse(
      normalizedAddress.contains(':')
          ? 'https://[$normalizedAddress]:$port'
          : 'https://$normalizedAddress:$port',
    );
    if (parsedAddress == null || parsedAddress.host.isEmpty) return null;
    return parsedAddress;
  }
}

final class NoopCompanionEndpointDiscovery
    implements CompanionEndpointDiscovery {
  const NoopCompanionEndpointDiscovery();

  @override
  Future<List<Uri>> findTrustedEndpoints(String hostId) async => const <Uri>[];

  @override
  Future<void> openSettings() async {}
}
