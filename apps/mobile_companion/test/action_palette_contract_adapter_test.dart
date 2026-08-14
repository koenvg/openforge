import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

void main() {
  test('adapts all server-advertised Task metadata for mobile rendering', () {
    final action = MobilePaletteActionContractAdapter.fromTaskPresentation(
      CompanionTaskActionPresentation(
        id: CompanionTaskActionId.completeTask,
        label: 'Complete 🏁',
        keywords: <String>['complete', 'finish'],
        icon: CompanionActionIcon.complete,
        requiresConfirmation: true,
        destructive: true,
      ),
    );

    expect(action.id, CompanionActionId.completeTask);
    expect(action.category, MobilePaletteCategory.task);
    expect(action.label, 'Complete 🏁');
    expect(action.keywords, <String>['complete', 'finish']);
    expect(action.icon, Icons.flag_outlined);
    expect(action.requiresConfirmation, isTrue);
    expect(action.destructive, isTrue);
  });

  test('adapts Project metadata without adding client-side capabilities', () {
    final action = MobilePaletteActionContractAdapter.fromProjectPresentation(
      CompanionProjectActionPresentation(
        id: CompanionProjectActionId.refreshGithub,
        label: 'Refresh GitHub',
        keywords: <String>['github', 'sync'],
        icon: CompanionActionIcon.refresh,
        requiresConfirmation: false,
        destructive: false,
      ),
    );

    expect(action.id, CompanionActionId.refreshGithub);
    expect(action.category, MobilePaletteCategory.general);
    expect(action.label, 'Refresh GitHub');
    expect(action.keywords, <String>['github', 'sync']);
    expect(action.icon, Icons.sync_rounded);
    expect(action.requiresConfirmation, isFalse);
    expect(action.destructive, isFalse);
  });
}
