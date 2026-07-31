import 'package:flutter/material.dart';

import '../connection/companion_connection_state.dart';

class ConnectedHostStatusCard extends StatelessWidget {
  const ConnectedHostStatusCard({required this.state, super.key});

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
