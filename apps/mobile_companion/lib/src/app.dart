import 'package:flutter/material.dart';

import 'connection/companion_connection_state.dart';

class CompanionApp extends StatelessWidget {
  const CompanionApp({this.initialState = const Unpaired(), super.key});

  final CompanionConnectionState initialState;

  @override
  Widget build(BuildContext context) => MaterialApp(
    debugShowCheckedModeBanner: false,
    title: 'OpenForge Companion',
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      useMaterial3: true,
    ),
    home: ConnectionShell(state: initialState),
  );
}

class ConnectionShell extends StatelessWidget {
  const ConnectionShell({required this.state, super.key});

  final CompanionConnectionState state;

  void _showPairingPlaceholder(BuildContext context) {
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Pairing will be added in a later release.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final content = _contentFor(state);

    return Scaffold(
      appBar: AppBar(title: const Text('OpenForge Companion')),
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 480),
              child: Semantics(
                container: true,
                explicitChildNodes: true,
                label: 'Connection state: ${content.title}',
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: <Widget>[
                    Icon(
                      content.icon,
                      size: 64,
                      semanticLabel: content.iconLabel,
                    ),
                    const SizedBox(height: 24),
                    Text(
                      content.title,
                      style: Theme.of(context).textTheme.headlineMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: 12),
                    Text(
                      content.message,
                      style: Theme.of(context).textTheme.bodyLarge,
                      textAlign: TextAlign.center,
                    ),
                    if (state is Unpaired) ...<Widget>[
                      const SizedBox(height: 32),
                      FilledButton.icon(
                        key: const Key('pair-with-desktop'),
                        onPressed: () => _showPairingPlaceholder(context),
                        icon: const Icon(Icons.qr_code_scanner),
                        label: const Text('Pair with desktop'),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

_ConnectionContent _contentFor(
  CompanionConnectionState state,
) => switch (state) {
  Unpaired() => const _ConnectionContent(
    title: 'Not paired',
    message:
        'Pair this companion with an OpenForge desktop to view live status.',
    icon: Icons.phonelink_off,
    iconLabel: 'Phone is not paired',
  ),
  Pairing() => const _ConnectionContent(
    title: 'Pairing',
    message: 'Preparing a secure connection to your OpenForge desktop.',
    icon: Icons.qr_code_scanner,
    iconLabel: 'Pairing in progress',
  ),
  AwaitingApproval() => const _ConnectionContent(
    title: 'Awaiting desktop approval',
    message: 'Approve this device from OpenForge on the desktop.',
    icon: Icons.approval_outlined,
    iconLabel: 'Waiting for approval',
  ),
  Connected() => const _ConnectionContent(
    title: 'Connected',
    message: 'This companion is connected to your OpenForge desktop.',
    icon: Icons.check_circle_outline,
    iconLabel: 'Desktop connected',
  ),
  Reconnecting() => const _ConnectionContent(
    title: 'Reconnecting',
    message: 'Trying to restore the secure desktop connection.',
    icon: Icons.sync,
    iconLabel: 'Connection is reconnecting',
  ),
  Unavailable() => const _ConnectionContent(
    title: 'Desktop unavailable',
    message: 'OpenForge must be running and reachable to show current data.',
    icon: Icons.cloud_off_outlined,
    iconLabel: 'Desktop is unavailable',
  ),
  Revoked() => const _ConnectionContent(
    title: 'Re-pair required',
    message:
        'This device no longer has access. Pair it again from the desktop.',
    icon: Icons.no_accounts_outlined,
    iconLabel: 'Device access was revoked',
  ),
  CertificateMismatch() => const _ConnectionContent(
    title: 'Certificate mismatch',
    message: 'The desktop identity could not be verified. Do not continue.',
    icon: Icons.gpp_bad_outlined,
    iconLabel: 'Desktop certificate does not match',
  ),
  IncompatibleProtocol() => const _ConnectionContent(
    title: 'Update required',
    message:
        'This companion and the desktop use incompatible protocol versions.',
    icon: Icons.system_update_outlined,
    iconLabel: 'Protocol version is incompatible',
  ),
};

final class _ConnectionContent {
  const _ConnectionContent({
    required this.title,
    required this.message,
    required this.icon,
    required this.iconLabel,
  });

  final String title;
  final String message;
  final IconData icon;
  final String iconLabel;
}
