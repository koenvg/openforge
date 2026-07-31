import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'connection/companion_connection_state.dart';
import 'pairing/companion_pairing_controller.dart';

class CompanionApp extends StatefulWidget {
  const CompanionApp({
    this.controller,
    this.initialState = const Unpaired(),
    super.key,
  });

  final CompanionPairingController? controller;
  final CompanionConnectionState initialState;

  @override
  State<CompanionApp> createState() => _CompanionAppState();
}

class _CompanionAppState extends State<CompanionApp> {
  final _navigatorKey = GlobalKey<NavigatorState>();
  late CompanionConnectionState _state;

  @override
  void initState() {
    super.initState();
    _state = widget.controller?.state ?? widget.initialState;
    widget.controller?.addListener(_onControllerChanged);
  }

  @override
  void dispose() {
    widget.controller?.removeListener(_onControllerChanged);
    super.dispose();
  }

  void _onControllerChanged() {
    setState(() => _state = widget.controller!.state);
  }

  Future<void> _openScanner() async {
    final controller = widget.controller;
    if (controller == null) return;
    final navigator = _navigatorKey.currentState;
    if (navigator == null) return;
    final qrPayload = await navigator.push<String>(
      MaterialPageRoute<String>(
        builder: (_) => const CompanionQrScannerScreen(),
      ),
    );
    if (qrPayload == null || !mounted) return;
    final platform = Platform.isIOS ? 'ios' : 'android';
    final fallbackName = Platform.isIOS ? 'My iPhone' : 'My Android phone';
    final suggestedName = Platform.localHostname.trim();
    final deviceName = await _requestDeviceName(
      _navigatorKey.currentContext!,
      suggestedName.isEmpty || suggestedName == 'localhost'
          ? fallbackName
          : suggestedName,
    );
    if (deviceName == null || !mounted) return;
    await controller.pairFromQr(
      qrPayload: qrPayload,
      deviceName: deviceName,
      platform: platform,
    );
  }

  Future<String?> _requestDeviceName(
    BuildContext context,
    String suggestedName,
  ) async {
    final textController = TextEditingController(text: suggestedName);
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Name this phone'),
        content: TextField(
          controller: textController,
          autofocus: true,
          maxLength: 80,
          decoration: const InputDecoration(
            labelText: 'Device name',
            helperText: 'This name will appear on your OpenForge desktop.',
          ),
        ),
        actions: <Widget>[
          TextButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () {
              final name = textController.text.trim();
              if (name.isNotEmpty) Navigator.of(context).pop(name);
            },
            child: const Text('Send request'),
          ),
        ],
      ),
    );
    textController.dispose();
    return result;
  }

  Future<void> _forgetAndPairAgain() async {
    final controller = widget.controller;
    if (controller == null) return;
    await controller.forgetAndReset();
    if (mounted) await _openScanner();
  }

  Future<void> _retryConnection() async {
    await widget.controller?.restore();
  }

  @override
  Widget build(BuildContext context) => MaterialApp(
    navigatorKey: _navigatorKey,
    debugShowCheckedModeBanner: false,
    title: 'OpenForge Companion',
    theme: ThemeData(
      colorScheme: ColorScheme.fromSeed(seedColor: Colors.indigo),
      useMaterial3: true,
    ),
    home: ConnectionShell(
      state: _state,
      onPair: widget.controller == null ? null : _openScanner,
      onReset: widget.controller == null ? null : _forgetAndPairAgain,
      onRetry: widget.controller == null ? null : _retryConnection,
    ),
  );
}

class CompanionQrScannerScreen extends StatefulWidget {
  const CompanionQrScannerScreen({super.key});

  @override
  State<CompanionQrScannerScreen> createState() =>
      _CompanionQrScannerScreenState();
}

class _CompanionQrScannerScreenState extends State<CompanionQrScannerScreen>
    with WidgetsBindingObserver {
  final MobileScannerController _scannerController = MobileScannerController();
  bool _handled = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  Future<void> _onDetect(BarcodeCapture capture) async {
    if (_handled) return;
    for (final barcode in capture.barcodes) {
      final payload = barcode.rawValue;
      if (payload == null) continue;
      _handled = true;
      try {
        await _scannerController.stop();
      } on Object catch (error, stackTrace) {
        debugPrint('Failed to stop the QR scanner: $error\n$stackTrace');
      }
      if (mounted) Navigator.of(context).pop(payload);
      return;
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (_handled || !_scannerController.value.hasCameraPermission) return;

    switch (state) {
      case AppLifecycleState.resumed:
        unawaited(_scannerController.start());
      case AppLifecycleState.inactive:
        unawaited(_scannerController.stop());
      case AppLifecycleState.detached:
      case AppLifecycleState.hidden:
      case AppLifecycleState.paused:
        return;
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    super.dispose();
    unawaited(_scannerController.dispose());
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('Scan desktop QR')),
    body: Semantics(
      label: 'Companion pairing QR scanner',
      child: MobileScanner(controller: _scannerController, onDetect: _onDetect),
    ),
  );
}

class ConnectionShell extends StatelessWidget {
  const ConnectionShell({
    required this.state,
    this.onPair,
    this.onReset,
    this.onRetry,
    super.key,
  });

  final CompanionConnectionState state;
  final VoidCallback? onPair;
  final VoidCallback? onReset;
  final VoidCallback? onRetry;

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
                      _ConnectedHostCard(state: state as Connected),
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

class _ConnectedHostCard extends StatelessWidget {
  const _ConnectedHostCard({required this.state});

  final Connected state;

  @override
  Widget build(BuildContext context) => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: <Widget>[
          Text('Host ${state.hostId}', textAlign: TextAlign.center),
          const SizedBox(height: 4),
          Text('Companion protocol v${state.protocolVersion}'),
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
