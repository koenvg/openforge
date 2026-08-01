import 'package:flutter/widgets.dart';

import 'agent_terminal_controller.dart';

final class AgentTerminalSurface {
  const AgentTerminalSurface({
    required this.presentation,
    required this.terminal,
    required this.dispose,
  });

  final AgentTerminalPresentation presentation;
  final Widget terminal;
  final VoidCallback dispose;
}
