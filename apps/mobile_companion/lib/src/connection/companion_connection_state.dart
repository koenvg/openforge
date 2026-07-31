/// The complete set of connection states defined by the Mobile Companion
/// design. Network transitions are intentionally owned by a later feature.
sealed class CompanionConnectionState {
  const CompanionConnectionState();
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

final class Connected extends CompanionConnectionState {
  const Connected();
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
