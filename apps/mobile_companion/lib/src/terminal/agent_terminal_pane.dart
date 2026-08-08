import 'package:flutter/material.dart';

import 'agent_terminal_controller.dart';
import 'agent_terminal_surface.dart';

class AgentTerminalPane extends StatelessWidget {
  const AgentTerminalPane({required this.surface, super.key});

  final AgentTerminalSurface? surface;

  @override
  Widget build(BuildContext context) {
    if (surface == null) {
      return const _TerminalStatus(
        label: 'No active Agent terminal',
        icon: Icons.terminal_outlined,
      );
    }
    return AnimatedBuilder(
      animation: surface!.presentation,
      builder: (context, _) => switch (surface!.presentation.state) {
        AgentTerminalNoActiveSession() => const _TerminalStatus(
          label: 'No active Agent terminal',
          icon: Icons.terminal_outlined,
        ),
        AgentTerminalAttaching() => const _TerminalStatus(
          label: 'Attaching to Agent terminal',
          icon: Icons.sync,
          progress: true,
        ),
        AgentTerminalReconnecting() => const _TerminalStatus(
          label: 'Reconnecting Agent terminal',
          icon: Icons.cloud_sync_outlined,
          progress: true,
        ),
        AgentTerminalReady() => Semantics(
          label: 'Agent terminal ready',
          container: true,
          child: surface!.terminal,
        ),
        AgentTerminalExited() => Stack(
          children: <Widget>[
            Positioned.fill(child: surface!.terminal),
            Align(
              alignment: Alignment.topRight,
              child: Semantics(
                label: 'Agent terminal exited',
                liveRegion: true,
                child: Card(
                  margin: const EdgeInsets.all(8),
                  child: Padding(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 10,
                      vertical: 6,
                    ),
                    child: const Text('Exited'),
                  ),
                ),
              ),
            ),
          ],
        ),
      },
    );
  }
}

class _TerminalStatus extends StatelessWidget {
  const _TerminalStatus({
    required this.label,
    required this.icon,
    this.progress = false,
  });

  final String label;
  final IconData icon;
  final bool progress;

  @override
  Widget build(BuildContext context) => Center(
    child: Semantics(
      label: label,
      liveRegion: true,
      child: ExcludeSemantics(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            Icon(icon, size: 48),
            const SizedBox(height: 16),
            Text(label, style: Theme.of(context).textTheme.titleMedium),
            if (progress) ...<Widget>[
              const SizedBox(height: 16),
              const CircularProgressIndicator(),
            ],
          ],
        ),
      ),
    ),
  );
}
