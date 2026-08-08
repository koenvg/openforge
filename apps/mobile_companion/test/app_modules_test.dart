import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_scanner.dart';
import 'package:openforge_companion/src/presentation/companion_app_shell.dart';
import 'package:openforge_companion/src/presentation/companion_connection_view.dart';

import 'support/widget_test_fakes.dart';

void main() {
  testWidgets(
    'app shell owns Material app configuration and renders its home',
    (tester) async {
      final navigatorKey = GlobalKey<NavigatorState>();

      await tester.pumpWidget(
        CompanionAppShell(
          navigatorKey: navigatorKey,
          home: const Text('Companion home', textDirection: TextDirection.ltr),
        ),
      );

      final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
      expect(app.navigatorKey, same(navigatorKey));
      expect(app.title, 'OpenForge Companion');
      expect(app.debugShowCheckedModeBanner, isFalse);
      expect(app.themeMode, ThemeMode.system);
      expect(find.text('Companion home'), findsOneWidget);
    },
  );

  testWidgets(
    'connection view composes authenticated content only for connected state',
    (tester) async {
      Widget buildView(CompanionConnectionState state) => MaterialApp(
        home: CompanionConnectionView(
          state: state,
          connectedView: const Text('Authenticated product'),
        ),
      );

      await tester.pumpWidget(
        buildView(const Connected(hostId: 'host-1', protocolVersion: 1)),
      );
      expect(find.text('Authenticated product'), findsOneWidget);
      expect(find.text('Connected'), findsNothing);

      await tester.pumpWidget(buildView(const Restoring()));
      expect(find.text('Authenticated product'), findsNothing);
      expect(find.text('Restoring connection'), findsOneWidget);
    },
  );

  testWidgets('connection view forwards pairing actions to the state surface', (
    tester,
  ) async {
    var pairCalls = 0;
    await tester.pumpWidget(
      MaterialApp(
        home: CompanionConnectionView(
          state: const Unpaired(),
          onPair: () => pairCalls += 1,
        ),
      ),
    );

    await tester.tap(find.byKey(const Key('pair-with-desktop')));
    expect(pairCalls, 1);
  });

  testWidgets('pairing scanner allows only one active capture flow', (
    tester,
  ) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(navigatorKey: navigatorKey, home: const SizedBox.shrink()),
    );
    final controller = pairingController();
    addTearDown(controller.dispose);
    final captureCompleter = Completer<void>();
    final activity = <bool>[];
    var captureCalls = 0;
    final scanner = CompanionPairingScanner(
      qrCapture:
          ({
            required navigator,
            required controller,
            required isControllerCurrent,
          }) {
            captureCalls += 1;
            return captureCompleter.future;
          },
      onActivityChanged: activity.add,
    );

    final firstCapture = scanner.scan(
      navigator: navigatorKey.currentState!,
      controller: controller,
      isControllerCurrent: () => true,
    );
    final ignoredCapture = scanner.scan(
      navigator: navigatorKey.currentState!,
      controller: controller,
      isControllerCurrent: () => true,
    );

    expect(scanner.isActive, isTrue);
    expect(captureCalls, 1);
    await ignoredCapture;
    captureCompleter.complete();
    await firstCapture;
    expect(scanner.isActive, isFalse);
    expect(activity, <bool>[true, false]);
  });

  testWidgets('pairing scanner restores availability after capture fails', (
    tester,
  ) async {
    final navigatorKey = GlobalKey<NavigatorState>();
    await tester.pumpWidget(
      MaterialApp(navigatorKey: navigatorKey, home: const SizedBox.shrink()),
    );
    final controller = pairingController();
    addTearDown(controller.dispose);
    final activity = <bool>[];
    final failure = StateError('Camera unavailable');
    final scanner = CompanionPairingScanner(
      qrCapture:
          ({
            required navigator,
            required controller,
            required isControllerCurrent,
          }) => Future<void>.error(failure),
      onActivityChanged: activity.add,
    );

    await expectLater(
      scanner.scan(
        navigator: navigatorKey.currentState!,
        controller: controller,
        isControllerCurrent: () => true,
      ),
      throwsA(same(failure)),
    );

    expect(scanner.isActive, isFalse);
    expect(activity, <bool>[true, false]);
  });
}
