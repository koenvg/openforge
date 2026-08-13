import 'package:flutter/material.dart';

import '../design_system/quiet_paper_theme.dart';

import '../connection/companion_connection_state.dart';
import 'connected_host_status_card.dart';

class ConnectionShell extends StatelessWidget {
  const ConnectionShell({
    required this.state,
    this.onPair,
    this.onManualPair,
    this.onReset,
    this.onRetry,
    this.onOpenSettings,
    super.key,
  });

  final CompanionConnectionState state;
  final VoidCallback? onPair;
  final VoidCallback? onManualPair;
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
                    if (state is Unpaired)
                      const _PairingTrustIllustration()
                    else
                      Icon(
                        content.icon,
                        size: 64,
                        color: Theme.of(context).colorScheme.primary,
                        semanticLabel: content.iconLabel,
                      ),
                    const SizedBox(height: QuietPaperSpacing.section),
                    if (state is Unpaired) ...<Widget>[
                      Text(
                        content.title,
                        style: Theme.of(context).textTheme.labelLarge?.copyWith(
                          color: Theme.of(context).colorScheme.onSurfaceVariant,
                        ),
                      ),
                      const SizedBox(height: QuietPaperSpacing.compact),
                    ],
                    Text(
                      state is Unpaired
                          ? 'Pair with your desktop'
                          : content.title,
                      style: Theme.of(context).textTheme.headlineMedium,
                      textAlign: TextAlign.center,
                    ),
                    const SizedBox(height: QuietPaperSpacing.related),
                    Text(
                      state is Unpaired
                          ? 'Scan the pairing code shown in OpenForge Settings.'
                          : content.message,
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
                      SizedBox(
                        width: double.infinity,
                        child: FilledButton.icon(
                          key: const Key('pair-with-desktop'),
                          onPressed: onPair,
                          icon: const Icon(Icons.qr_code_scanner),
                          label: const Text('Scan pairing code'),
                        ),
                      ),
                    ],
                    if ((state is Unpaired ||
                            state is PairingRejected ||
                            state is PairingUnavailable) &&
                        onManualPair != null) ...<Widget>[
                      const SizedBox(height: 12),
                      SizedBox(
                        width: double.infinity,
                        child: OutlinedButton.icon(
                          key: const Key('pair-manually'),
                          onPressed: onManualPair,
                          icon: const Icon(Icons.keyboard_alt_outlined),
                          label: const Text('Enter code manually'),
                        ),
                      ),
                    ],
                    if (state is Unpaired) ...<Widget>[
                      const SizedBox(height: QuietPaperSpacing.section),
                      const _PinnedConnectionNotice(),
                      const SizedBox(height: QuietPaperSpacing.related),
                      Text(
                        content.message,
                        style: Theme.of(context).textTheme.bodySmall,
                        textAlign: TextAlign.center,
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
                    if (state is IncompatibleProtocol &&
                        onRetry != null) ...<Widget>[
                      const SizedBox(height: 32),
                      FilledButton.icon(
                        key: const Key('check-protocol-again'),
                        onPressed: onRetry,
                        icon: const Icon(Icons.refresh),
                        label: const Text('Check again'),
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

class _PairingTrustIllustration extends StatelessWidget {
  const _PairingTrustIllustration();

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Semantics(
      image: true,
      label: 'Trusted encrypted connection between this phone and desktop',
      child: ExcludeSemantics(
        child: Container(
          constraints: const BoxConstraints(maxWidth: 280),
          padding: const EdgeInsets.all(QuietPaperSpacing.section),
          decoration: BoxDecoration(
            color: colors.surfaceContainerLow,
            border: Border.all(color: colors.outlineVariant),
            borderRadius: BorderRadius.circular(QuietPaperShapes.cardRadius),
          ),
          child: Row(
            children: <Widget>[
              Icon(
                Icons.laptop_mac_outlined,
                size: 52,
                color: colors.onSurface,
              ),
              Expanded(
                child: Row(
                  children: <Widget>[
                    Expanded(child: Divider(color: colors.outline)),
                    Padding(
                      padding: const EdgeInsets.symmetric(
                        horizontal: QuietPaperSpacing.compact,
                      ),
                      child: Icon(
                        Icons.verified_user_outlined,
                        color: colors.primary,
                      ),
                    ),
                    Expanded(child: Divider(color: colors.outline)),
                  ],
                ),
              ),
              Icon(
                Icons.phone_iphone_outlined,
                size: 48,
                color: colors.onSurface,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _PinnedConnectionNotice extends StatelessWidget {
  const _PinnedConnectionNotice();

  @override
  Widget build(BuildContext context) => Semantics(
    container: true,
    label: 'Pinned, encrypted connection',
    child: ExcludeSemantics(
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: <Widget>[
          Icon(
            Icons.shield_outlined,
            color: Theme.of(context).colorScheme.primary,
          ),
          const SizedBox(width: QuietPaperSpacing.compact),
          const Flexible(child: Text('Pinned, encrypted connection')),
        ],
      ),
    ),
  );
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
        'Pairing lets this phone Create backlog Tasks from a prompt, Start backlog Tasks, Delete or Complete Tasks, '
        'and interact with running Agent terminals as your desktop user, in '
        'addition to viewing live Task status.',
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
    message:
        'Approval lets this phone Create backlog Tasks from a prompt, Start backlog Tasks, Delete or Complete Tasks, '
        'and interact with running Agent terminals as your desktop user while '
        'viewing Task data.',
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
        'The secure pairing request could not be completed. Keep Tailscale '
        'connected, generate a fresh pairing code, and retry.',
    icon: Icons.cloud_off_outlined,
    iconLabel: 'Pairing request is unavailable',
  ),
  Connected() => const _ConnectionContent(
    title: 'Connected',
    message:
        'This paired device can Create backlog Tasks from a prompt, Start backlog Tasks, Delete or Complete Tasks, '
        'and interact with running Agent terminals as your desktop user. This '
        'authority remains available while the Mac is locked and ends when the '
        'gateway is disabled, the device is revoked, or Companion identity changes.',
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
        'Update the companion or desktop, then check the secure connection again.',
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
