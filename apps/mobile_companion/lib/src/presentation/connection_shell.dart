import 'package:flutter/material.dart';

import '../connection/companion_connection_state.dart';
import 'connected_host_status_card.dart';

class ConnectionShell extends StatelessWidget {
  const ConnectionShell({
    required this.state,
    this.onPair,
    this.onReset,
    this.onRetry,
    this.onOpenSettings,
    super.key,
  });

  final CompanionConnectionState state;
  final VoidCallback? onPair;
  final VoidCallback? onReset;
  final VoidCallback? onRetry;
  final VoidCallback? onOpenSettings;

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
                    if (state is Connected) ...<Widget>[
                      const SizedBox(height: 24),
                      ConnectedHostStatusCard(state: state as Connected),
                    ],
                    if ((state is Unpaired ||
                            state is PairingRejected ||
                            state is PairingUnavailable) &&
                        onPair != null) ...<Widget>[
                      const SizedBox(height: 32),
                      FilledButton.icon(
                        key: const Key('pair-with-desktop'),
                        onPressed: onPair,
                        icon: const Icon(Icons.qr_code_scanner),
                        label: const Text('Pair with desktop'),
                      ),
                    ],
                    if ((state is Revoked || state is CertificateMismatch) &&
                        onReset != null) ...<Widget>[
                      const SizedBox(height: 32),
                      FilledButton.icon(
                        key: const Key('forget-and-pair-again'),
                        onPressed: onReset,
                        icon: const Icon(Icons.qr_code_scanner),
                        label: const Text('Forget and pair again'),
                      ),
                    ],
                    if (state is Unavailable && onRetry != null) ...<Widget>[
                      const SizedBox(height: 32),
                      FilledButton.icon(
                        key: const Key('retry-connection'),
                        onPressed: onRetry,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
                      ),
                    ],
                    if (state is LocalNetworkPermissionDenied &&
                        onOpenSettings != null) ...<Widget>[
                      const SizedBox(height: 32),
                      FilledButton.icon(
                        key: const Key('open-local-network-settings'),
                        onPressed: onOpenSettings,
                        icon: const Icon(Icons.settings_outlined),
                        label: const Text('Open settings'),
                      ),
                    ],
                    if (state is LocalNetworkPermissionDenied &&
                        onRetry != null) ...<Widget>[
                      const SizedBox(height: 12),
                      OutlinedButton.icon(
                        key: const Key('retry-local-network-discovery'),
                        onPressed: onRetry,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Retry'),
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
  Restoring() => const _ConnectionContent(
    title: 'Restoring connection',
    message: 'Checking securely stored desktop trust.',
    icon: Icons.sync,
    iconLabel: 'Restoring paired desktop connection',
  ),
  Unpaired() => const _ConnectionContent(
    title: 'Not paired',
    message:
        'Pair this companion with an OpenForge desktop to view live status.',
    icon: Icons.phonelink_off,
    iconLabel: 'Phone is not paired',
  ),
  Pairing() => const _ConnectionContent(
    title: 'Pairing',
    message: 'Verifying the desktop certificate and sending this device name.',
    icon: Icons.qr_code_scanner,
    iconLabel: 'Pairing in progress',
  ),
  AwaitingApproval() => const _ConnectionContent(
    title: 'Awaiting desktop approval',
    message: 'Approve this device from OpenForge on the desktop.',
    icon: Icons.approval_outlined,
    iconLabel: 'Waiting for approval',
  ),
  PairingRejected() => const _ConnectionContent(
    title: 'Pairing rejected',
    message:
        'The desktop rejected this device. Start a new pairing session to retry.',
    icon: Icons.block_outlined,
    iconLabel: 'Pairing request was rejected',
  ),
  PairingUnavailable() => const _ConnectionContent(
    title: 'Pairing unavailable',
    message:
        'The pairing request could not be completed. Try a new QR session.',
    icon: Icons.cloud_off_outlined,
    iconLabel: 'Pairing request is unavailable',
  ),
  Connected() => const _ConnectionContent(
    title: 'Connected',
    message:
        'Authenticated read-only access to this OpenForge desktop is active.',
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
  LocalNetworkPermissionDenied() => const _ConnectionContent(
    title: 'Local network access needed',
    message:
        'Allow Local Network access in Settings to find your paired OpenForge desktop.',
    icon: Icons.wifi_off_outlined,
    iconLabel: 'Local network discovery permission was denied',
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
