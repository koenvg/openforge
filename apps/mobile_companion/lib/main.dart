import 'package:flutter/material.dart';

import 'src/app.dart';
import 'src/client/companion_client.dart';
import 'src/pairing/companion_pairing_controller.dart';
import 'src/storage/companion_secure_storage.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final controller = CompanionPairingController(
    client: const GeneratedCompanionClient(),
    storage: PlatformCompanionSecureStorage(),
  );
  runApp(CompanionApp(controller: controller));
  controller.restore();
}
