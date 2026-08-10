---
status: accepted
---

# Pairing grants Companion Task authority without re-approval

During pre-release development, every existing and newly approved **Paired Companion Device** receives the narrow authority to create a prompt-only backlog Task in a visible Project, start a backlog Task using its saved defaults, and Delete or Complete a Task with the same lifecycle behavior as the desktop. Creation uses desktop-saved Project defaults and exposes no provider, permission, worktree, label, dependency, or generic command controls. Complete may stop a running Agent before Task workspace cleanup. Existing devices gain this authority without re-pairing or renewed desktop approval because pairing already grants command-equivalent Companion terminal authority. Companion Task authority remains valid while the macOS screen is locked so away-from-desk operation still works; gateway disablement and device revocation remain the authorization boundaries. A future distribution-readiness review may introduce narrower capabilities or renewed consent, but the pre-release protocol does not add a scope system for these actions.
