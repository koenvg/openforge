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
        AgentTerminalAttaching() => _CoveredTerminalStatus(
          terminal: surface!.terminal,
          label: 'Attaching to Agent terminal',
        ),
        AgentTerminalReconnecting(:final retryAvailable) =>
          _ReconnectingTerminal(
            terminal: surface!.terminal,
            retryAvailable: retryAvailable,
            onRetry: surface!.presentation.retryNow,
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

final class _CoveredTerminalStatus extends StatelessWidget {
  const _CoveredTerminalStatus({required this.terminal, required this.label});

  final Widget terminal;
  final String label;

  @override
  Widget build(BuildContext context) => Stack(
    children: <Widget>[
      Positioned.fill(child: terminal),
      Positioned.fill(
        child: ColoredBox(
          color: Theme.of(context).colorScheme.surface,
          child: _TerminalStatus(
            label: label,
            icon: Icons.sync,
            progress: true,
          ),
        ),
      ),
    ],
  );
}

final class _ReconnectingTerminal extends StatelessWidget {
  const _ReconnectingTerminal({
    required this.terminal,
    required this.retryAvailable,
    required this.onRetry,
  });

  final Widget terminal;
  final bool retryAvailable;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final label = retryAvailable
        ? 'Connection interrupted'
        : 'Reconnecting Agent terminal';
    return Stack(
      children: <Widget>[
        Positioned.fill(child: terminal),
        Align(
          alignment: Alignment.topRight,
          child: Semantics(
            label: retryAvailable
                ? 'Connection interrupted, retrying automatically'
                : label,
            liveRegion: true,
            child: Card(
              margin: const EdgeInsets.all(8),
              child: Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: 12,
                  vertical: 6,
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: <Widget>[
                    if (retryAvailable)
                      const Icon(Icons.cloud_off_outlined, size: 20)
                    else
                      const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    const SizedBox(width: 8),
                    Text(label),
                    if (retryAvailable) ...<Widget>[
                      const SizedBox(width: 8),
                      TextButton(
                        onPressed: onRetry,
                        child: const Text('Retry now'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ],
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
