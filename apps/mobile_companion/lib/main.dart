import 'package:flutter/material.dart';

import 'src/app.dart';
import 'src/attention/attention_controller.dart';
import 'src/client/companion_client.dart';
import 'src/discovery/bonjour_discovery_browser.dart';
import 'src/discovery/companion_discovery.dart';
import 'src/live/live_updates_controller.dart';
import 'src/pairing/companion_pairing_controller.dart';
import 'src/storage/companion_secure_storage.dart';
import 'src/task_detail/task_detail_controller.dart';
import 'src/terminal/agent_terminal_controller.dart';
import 'src/terminal/agent_terminal_surface.dart';
import 'src/terminal/xterm_terminal_adapter.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  final client = GeneratedCompanionClient();
  final storage = PlatformCompanionSecureStorage();
  final pairingController = CompanionPairingController(
    client: client,
    storage: storage,
    discovery: const TrustedCompanionEndpointDiscovery(
      browser: BonjourCompanionDiscoveryBrowser(),
    ),
  );
  final attentionController = AttentionController(
    client: client,
    storage: storage,
    onAuthorizationLost: pairingController.authorizationLost,
  );
  final liveUpdatesController = LiveUpdatesController(
    client: client,
    storage: storage,
    attention: attentionController,
    onReconnecting: pairingController.liveReconnecting,
    onConnected: pairingController.liveConnected,
    onUnavailable: pairingController.liveUnavailable,
    onAuthorizationLost: pairingController.authorizationLost,
    onCertificateMismatch: pairingController.liveCertificateMismatch,
    onIncompatible: pairingController.liveIncompatible,
  );
  runApp(
    CompanionApp(
      controller: pairingController,
      attentionController: attentionController,
      liveUpdatesController: liveUpdatesController,
      taskDetailControllerFactory: (taskId) => TaskDetailController(
        taskId: taskId,
        client: client,
        storage: storage,
        onAuthorizationLost: pairingController.authorizationLost,
      ),
      agentTerminalSurfaceFactory: (taskId) {
        late AgentTerminalController terminalController;
        final adapter = XtermOpenForgeTerminal(
          onResize: (dimensions) => terminalController.resize(dimensions),
        );
        terminalController = AgentTerminalController(
          taskId: taskId,
          client: client,
          storage: storage,
          terminal: adapter,
          onAuthorizationLost: pairingController.authorizationLost,
        );
        return AgentTerminalSurface(
          presentation: terminalController,
          terminal: OpenForgeTerminalView(adapter: adapter),
          dispose: terminalController.dispose,
        );
      },
    ),
  );
  pairingController.restore();
}
