import 'package:flutter/material.dart';

import 'src/action_palette/action_palette_controller.dart';
import 'src/app.dart';
import 'src/project_board/project_board_controller.dart';
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
  final projectBoardController = ProjectBoardController(
    client: client,
    storage: storage,
    onAuthorizationLost: pairingController.authorizationLost,
  );
  final actionPaletteController = MobileActionPaletteController(
    taskClient: client,
    completionClient: client,
    paletteClient: client,
    storage: storage,
    onRefresh: projectBoardController.refresh,
    onAuthorizationLost: pairingController.authorizationLost,
  );
  final liveUpdatesController = LiveUpdatesController(
    client: client,
    storage: storage,
    projectBoard: projectBoardController,
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
      projectBoardController: projectBoardController,
      actionPaletteController: actionPaletteController,
      liveUpdatesController: liveUpdatesController,
      taskDetailControllerFactory: (taskId) => TaskDetailController(
        taskId: taskId,
        client: client,
        actionClient: client,
        storage: storage,
        onAuthorizationLost: pairingController.authorizationLost,
        onBoardRefresh: projectBoardController.refreshWithOutcome,
      ),
      agentTerminalSurfaceFactory: (taskId) {
        late AgentTerminalController terminalController;
        final adapter = XtermOpenForgeTerminal(
          onInput: (input) => terminalController.sendInput(input),
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
          terminal: OpenForgeTerminalView(
            adapter: adapter,
            inputState: terminalController,
            isInputEnabled: () => terminalController.inputEnabled,
          ),
          dispose: terminalController.dispose,
        );
      },
    ),
  );
  pairingController.restore();
}
