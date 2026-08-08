import 'package:flutter/material.dart';

import '../connection/companion_connection_state.dart';
import 'connection_shell.dart';

class CompanionConnectionView extends StatelessWidget {
  const CompanionConnectionView({
    required this.state,
    this.connectedView,
    this.onPair,
    this.onManualPair,
    this.onReset,
    this.onRetry,
    this.onOpenSettings,
    super.key,
  });

  final CompanionConnectionState state;
  final Widget? connectedView;
  final VoidCallback? onPair;
  final VoidCallback? onManualPair;
  final VoidCallback? onReset;
  final VoidCallback? onRetry;
  final VoidCallback? onOpenSettings;

  @override
  Widget build(BuildContext context) {
    final connectedView = this.connectedView;
    if (state is Connected && connectedView != null) return connectedView;

    return ConnectionShell(
      state: state,
      onPair: onPair,
      onManualPair: onManualPair,
      onReset: onReset,
      onRetry: onRetry,
      onOpenSettings: onOpenSettings,
    );
  }
}
