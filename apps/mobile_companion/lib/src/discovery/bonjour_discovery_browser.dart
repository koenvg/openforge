import 'dart:async';

import 'package:bonsoir/bonsoir.dart';
import 'package:flutter/services.dart';

import 'companion_discovery.dart';

const _settingsChannel = MethodChannel('app.openforge.companion/settings');

final class BonjourCompanionDiscoveryBrowser
    implements CompanionDiscoveryBrowser {
  const BonjourCompanionDiscoveryBrowser();

  @override
  Future<List<DiscoveredCompanionService>> browse({
    required String serviceType,
    required Duration timeout,
  }) async {
    final discovery = BonsoirDiscovery(type: serviceType, printLogs: false);
    StreamSubscription<BonsoirDiscoveryEvent>? subscription;
    var started = false;
    final resolved = <String, DiscoveredCompanionService>{};
    final streamError = Completer<Object?>();
    try {
      await discovery.initialize();
      subscription = discovery.eventStream!.listen(
        (event) {
          switch (event) {
            case BonsoirDiscoveryServiceFoundEvent():
              unawaited(
                event.service.resolve(discovery.serviceResolver).catchError((
                  Object error,
                ) {
                  if (!streamError.isCompleted) streamError.complete(error);
                }),
              );
            case BonsoirDiscoveryServiceResolvedEvent():
              _recordService(resolved, event.service);
            case BonsoirDiscoveryServiceUpdatedEvent():
              _recordService(resolved, event.service);
            case BonsoirDiscoveryServiceLostEvent():
              resolved.remove(event.service.name);
            default:
              break;
          }
        },
        onError: (Object error) {
          if (!streamError.isCompleted) streamError.complete(error);
        },
      );
      await discovery.start();
      started = true;
      final error = await Future.any<Object?>(<Future<Object?>>[
        Future<Object?>.delayed(timeout),
        streamError.future,
      ]);
      if (error != null) throw error;
      return List<DiscoveredCompanionService>.unmodifiable(resolved.values);
    } on PlatformException catch (error) {
      if (isCompanionDiscoveryPermissionError(error)) {
        throw const CompanionDiscoveryPermissionDenied();
      }
      rethrow;
    } finally {
      if (started && !discovery.isStopped) {
        await discovery.stop();
      }
      await subscription?.cancel();
    }
  }

  @override
  Future<void> openSettings() =>
      _settingsChannel.invokeMethod<void>('openAppSettings');

  static void _recordService(
    Map<String, DiscoveredCompanionService> resolved,
    BonsoirService service,
  ) {
    if (service.hostAddresses.isEmpty || service.port == 0) return;
    resolved[service.name] = DiscoveredCompanionService(
      attributes: Map<String, String>.unmodifiable(service.attributes),
      hostAddresses: List<String>.unmodifiable(service.hostAddresses),
      port: service.port,
    );
  }
}

bool isCompanionDiscoveryPermissionError(Object error) {
  if (error is! PlatformException) return false;
  final description = '${error.code} ${error.message} ${error.details}'
      .toLowerCase();
  return error.details == 7 ||
      description.contains('permission') ||
      description.contains('policydenied') ||
      description.contains('-65570');
}
