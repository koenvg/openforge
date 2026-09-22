## 1. Cover the mobile suggestion interaction

- [x] 1.1 Add widget tests in `apps/mobile_companion/test/task_creation_sheet_test.dart` for the picker above the prompt, both the prompt and a tappable result visible with a simulated phone keyboard, and a long list that scrolls without losing prompt access; run the focused Flutter test and confirm the new layout assertions fail before implementation.
- [x] 1.2 Extend the same tests for `/` and `$` filtering, tap-to-insert without creating a Task, dismissal on ordinary text, readable wrapped descriptions, and touch-friendly rows at increased text scale; verify the relevant tests establish the expected behavior.

## 2. Place and size the picker

- [x] 2.1 Update `apps/mobile_companion/lib/src/project_board/task_creation_sheet.dart` to place the existing styled suggestion list immediately above the prompt and bound its height to the available keyboard-aware viewport while keeping longer results scrollable; verify the focused widget tests pass on a small simulated phone.
- [x] 2.2 Keep the suggestion/prompt region visible as keyboard insets and asynchronous results change without obscuring prompt editing or changing provider insertion behavior; verify keyboard, long-list, and `/` and `$` selection tests pass.

## 3. Validate the mobile change

- [x] 3.1 Run `flutter test test/task_creation_sheet_test.dart`, the mobile companion Flutter test suite, `flutter analyze`, and `dart format --output=none --set-exit-if-changed` on changed Dart files from `apps/mobile_companion`; confirm all checks pass and report any remaining device-only visibility gaps.
