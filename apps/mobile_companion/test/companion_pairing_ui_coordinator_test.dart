import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_ui_coordinator.dart';

import 'support/widget_test_fakes.dart';

void main() {
  testWidgets(
    'pairing UI coordinator binds capture to the current navigator and controller',
    (tester) async {
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(navigatorKey: navigatorKey, home: const SizedBox.shrink()),
      );
      final oldController = pairingController();
      final newController = pairingController();
      addTearDown(oldController.dispose);
      addTearDown(newController.dispose);
      final captureCompleter = Completer<void>();
      late bool Function() currentCheck;
      CompanionPairingController? capturedController;
      NavigatorState? capturedNavigator;
      final activity = <bool>[];
      final coordinator = CompanionPairingUiCoordinator(
        navigatorKey: navigatorKey,
        controller: oldController,
        qrCapture:
            ({
              required navigator,
              required controller,
              required isControllerCurrent,
            }) {
              capturedNavigator = navigator;
              capturedController = controller;
              currentCheck = isControllerCurrent;
              return captureCompleter.future;
            },
      );
      coordinator.addListener(() => activity.add(coordinator.isActive));
      addTearDown(coordinator.dispose);

      final capture = coordinator.openScanner();
      expect(capturedNavigator, same(navigatorKey.currentState));
      expect(capturedController, same(oldController));
      expect(currentCheck(), isTrue);
      expect(coordinator.isActive, isTrue);

      coordinator.updateController(newController);
      expect(currentCheck(), isFalse);

      captureCompleter.complete();
      await capture;
      expect(coordinator.isActive, isFalse);
      expect(activity, <bool>[true, false]);
    },
  );
}
