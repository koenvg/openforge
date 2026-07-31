/// The complete set of connection states defined by the Mobile Companion design.
sealed class CompanionConnectionState {
  const CompanionConnectionState();
}

final class Restoring extends CompanionConnectionState {
  const Restoring();
}

final class Unpaired extends CompanionConnectionState {
  const Unpaired();
}

final class Pairing extends CompanionConnectionState {
  const Pairing();
}

final class AwaitingApproval extends CompanionConnectionState {
  const AwaitingApproval();
}

final class PairingRejected extends CompanionConnectionState {
  const PairingRejected();
}

final class PairingUnavailable extends CompanionConnectionState {
  const PairingUnavailable();
}

final class Connected extends CompanionConnectionState {
  const Connected({required this.hostId, required this.protocolVersion});

  final String hostId;
  final int protocolVersion;
}

final class Reconnecting extends CompanionConnectionState {
  const Reconnecting();
}

final class Unavailable extends CompanionConnectionState {
  const Unavailable();
}

final class Revoked extends CompanionConnectionState {
  const Revoked();
}

final class CertificateMismatch extends CompanionConnectionState {
  const CertificateMismatch();
}

final class IncompatibleProtocol extends CompanionConnectionState {
  const IncompatibleProtocol();
}
