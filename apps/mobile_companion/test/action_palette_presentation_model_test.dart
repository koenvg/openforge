import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette.dart';

const _start = MobilePaletteAction(
  id: CompanionActionId.startTask,
  label: 'Start Task',
  keywords: <String>['run', 'begin'],
  icon: Icons.play_arrow_rounded,
  category: MobilePaletteCategory.task,
);

const _complete = MobilePaletteAction(
  id: CompanionActionId.completeTask,
  label: 'Complete',
  keywords: <String>['finish'],
  icon: Icons.flag_outlined,
  category: MobilePaletteCategory.task,
  requiresConfirmation: true,
  destructive: true,
);

void main() {
  test('filters actions by normalized label and advertised keywords', () {
    final model = MobileActionPalettePresentationModel(
      actions: const <MobilePaletteAction>[_start, _complete],
      onExecute: (_) async {},
    );
    addTearDown(model.dispose);

    model.updateQuery('  RUN  ');
    expect(model.filteredActions, const <MobilePaletteAction>[_start]);

    model.updateQuery('complete');
    expect(model.filteredActions, const <MobilePaletteAction>[_complete]);

    model.updateQuery('missing');
    expect(model.filteredActions, isEmpty);
  });

  test('requires approval before executing a confirmable action', () async {
    final confirmations = <CompanionActionId>[];
    final executions = <CompanionActionId>[];
    final model = MobileActionPalettePresentationModel(
      actions: const <MobilePaletteAction>[_complete],
      onConfirm: (action) async {
        confirmations.add(action.id);
        return false;
      },
      onExecute: (action) async => executions.add(action.id),
    );
    addTearDown(model.dispose);

    await model.execute(_complete);

    expect(confirmations, <CompanionActionId>[CompanionActionId.completeTask]);
    expect(executions, isEmpty);
    expect(model.pendingActionId, isNull);
  });

  test('blocks overlapping execution and clears pending state', () async {
    final executionStarted = Completer<void>();
    final releaseExecution = Completer<void>();
    final executions = <CompanionActionId>[];
    final model = MobileActionPalettePresentationModel(
      actions: const <MobilePaletteAction>[_start, _complete],
      onExecute: (action) async {
        executions.add(action.id);
        executionStarted.complete();
        await releaseExecution.future;
      },
    );
    addTearDown(model.dispose);

    final firstExecution = model.execute(_start);
    await executionStarted.future;

    expect(model.pendingActionId, CompanionActionId.startTask);
    await model.execute(_complete);
    expect(executions, <CompanionActionId>[CompanionActionId.startTask]);

    releaseExecution.complete();
    await firstExecution;
    expect(model.pendingActionId, isNull);
  });
}
