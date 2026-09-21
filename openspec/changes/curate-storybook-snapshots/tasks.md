## 1. Coverage accounting

- [x] 1.1 Record current manifest identities, family/theme/viewport counts, and canonical phase timings; verify the report reconciles to the current manifest and names the tested revision and environment.
- [x] 1.2 Create the retained/replaced/removed coverage inventory, protecting runner representatives and documented regressions; verify every current identity has a rationale and every replacement references a real story or behavioral assertion.

## 2. Consolidate component cases

- [x] 2.1 Add any missing task-status mapping assertions before snapshot removal; verify focused behavioral tests fail without the expected mapping and pass with the existing correct behavior.
- [x] 2.2 Add small task-list variant galleries without deleting isolated stories; verify both-theme pinned-container captures show all labels and variants without clipping and preserve separate unique layout/interaction cases.
- [ ] 2.3 Curate remaining shared component state/theme cases using the inventory; verify retained coverage includes theme-sensitive controls, focus, overlays, overflow, and known regression identities.

## 3. Curate page cases and baselines

- [ ] 3.1 Curate page-level empty/loading/failure and theme repetitions while retaining distinct layout and media/terminal risks; verify every removal maps to reviewed replacement appearance coverage and any necessary behavioral assertion.
- [ ] 3.2 Update the manifest and review new gallery baselines in the canonical container; explicitly remove approved obsolete images and verify baseline inventory validation has no missing or unexpected files.
- [ ] 3.3 Document selection rules and the completed coverage inventory in the visual guide; verify the final count approaches 200–250 or explicitly explains why preserved unique risks require a different count.

## 4. Full validation

- [ ] 4.1 Run the complete canonical visual test, visual unit tests, root frontend tests and available static checks, plus affected workspace tests/static checks and applicable contracts; verify every selected case passes baseline and repeatability and all required probes still pass. Record commands and any environment blockers.
- [ ] 4.2 Compare before/after capture counts, phase timings, and total duration on equivalent hardware; verify the report distinguishes measured savings from estimates and includes human review of changed images.
