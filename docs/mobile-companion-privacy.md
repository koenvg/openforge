# Mobile Companion privacy and network boundary

OpenForge Companion v1 is a privately distributed client for a user-owned OpenForge desktop. It is not a hosted OpenForge service.

## No OpenForge Companion server

OpenForge operates no Companion account system, synchronization server, rendezvous service, relay, push provider, analytics endpoint, or central store. The OpenForge desktop is the authoritative host. The desktop app and its opt-in Companion Gateway must be running and reachable for the mobile app to show current information or attach to a Task Agent terminal.

Stopping the desktop or disabling the gateway makes the mobile app show **Desktop Unavailable** and removes domain content from the active view. The mobile app does not fall back to an OpenForge cloud copy because no such copy exists.

## User-managed networking

LAN is the normal nearby path. Remote connectivity may use Tailscale installed and administered by the user on the desktop and phone. OpenForge does not create or administer the tailnet, access Tailscale account credentials, or call hosted Tailscale APIs.

Tailscale may use its own coordination and encrypted relay infrastructure. That is user-selected network infrastructure, not an OpenForge server. Companion application traffic still requires the paired device credential and the exact pinned desktop certificate.

Discovery and endpoint switching do not grant trust. A discovered LAN or MagicDNS address is accepted only for the already paired host identity and certificate. A certificate mismatch must be rejected rather than prompting the user to continue insecurely.

## Data retained on the phone

Platform secure storage retains only what is required to recognize and authenticate the paired host:

- host identity and pinned certificate fingerprint;
- endpoint candidates;
- device identity and device credential.

Attention, Project, Task, and terminal data remain in memory for the foreground session. They are not stored as an offline domain snapshot in preferences, files, SQLite, analytics, backups, or another application cache. Suspend, stream-gap, revocation, gateway shutdown, and unavailable-host handling clear domain views before a fresh authenticated read.

Revoking a device or resetting desktop host identity invalidates the mobile credential and requires QR pairing plus desktop approval again.

## Foreground-only live behavior

V1 performs live invalidation and reconnect work only while the app is in the foreground. Suspending the app stops live networking; resuming clears stale views and requests a fresh authenticated snapshot.

There are no APNs or Firebase notifications, silent pushes, background fetch guarantees, notification extensions, or OpenForge notification provider. Testers should expect no background alerts and must open the app to refresh.

## Product and release exclusions

V1 includes no analytics, advertising, subscriptions, in-app purchases, hosted telemetry, public App Store submission, public Play Store submission, or feature expansion as part of release-candidate work. Private TestFlight/internal/direct distribution does not change these boundaries.

Never include pairing QR contents, bearer credentials, private keys, provisioning profiles, signing passwords, private Task content, or terminal output in acceptance evidence or release logs.
