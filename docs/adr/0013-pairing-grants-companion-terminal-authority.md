---
status: accepted
---

# Pairing grants Companion terminal authority during pre-release development

The Companion Gateway previously issued credentials with a fixed read-only capability. While the app remains under development, every device explicitly approved through desktop pairing may also attach to, write to, and resize an existing Agent Session. We are deliberately deferring per-device terminal grants and a general scope system to keep the first interactive-terminal protocol small; gateway disablement and device revocation remain the authorization boundaries. Pairing authority remains valid while the macOS screen is locked, provided the OpenForge process and Companion Gateway are still running, because away-from-desk operation is the purpose of the feature. The pre-release Companion v1 contract will evolve in place with terminal availability and attachment routes rather than introducing v2 solely to preserve the earlier read-only draft. This decision must be revisited before distribution beyond developer-controlled devices because terminal access is equivalent to remote command execution as the desktop user.
