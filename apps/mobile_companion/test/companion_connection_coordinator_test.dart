import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/attention/attention_controller.dart';
import 'package:openforge_companion/src/client/companion_client.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';
import 'package:openforge_companion/src/connection/companion_connection_coordinator.dart';
import 'package:openforge_companion/src/connection/companion_connection_state.dart';
import 'package:openforge_companion/src/live/live_updates_controller.dart';
import 'package:openforge_companion/src/pairing/companion_pairing_controller.dart';
import 'package:openforge_companion/src/project_board/project_board_controller.dart';
import 'package:openforge_companion/src/storage/companion_secure_storage.dart';
import 'package:openforge_companion/src/task_detail/task_detail_controller.dart';

import 'support/widget_test_fakes.dart';

void main() {
  test('connection coordinator transfers pairing state ownership', () {
    final oldController = pairingController();
    final newController = pairingController()..liveUnavailable();
    final coordinator = CompanionConnectionCoordinator(
      pairingController: oldController,
      initialState: const Unpaired(),
    );
    addTearDown(oldController.dispose);
    addTearDown(newController.dispose);
    addTearDown(coordinator.dispose);
    final observedStates = <Type>[];
    coordinator.addListener(
      () => observedStates.add(coordinator.connectionState.runtimeType),
    );

    expect(coordinator.connectionState, isA<Restoring>());

    coordinator.update(pairingController: newController);
    expect(coordinator.connectionState, isA<Unavailable>());

    oldController.authorizationLost();
    expect(coordinator.connectionState, isA<Unavailable>());

    newController.authorizationLost();
    expect(coordinator.connectionState, isA<Revoked>());
    expect(observedStates, <Type>[Unavailable, Revoked]);
  });

  testWidgets(
    'connection coordinator owns live updates and clears authenticated views on disconnect',
    (tester) async {
      final client = _LifecycleClient();
      final storage = _ProjectStorage(trustRecord);
      final pairing = CompanionPairingController(
        client: client,
        storage: storage,
      );
      await pairing.restore();
      final board = ProjectBoardController(client: client, storage: storage);
      final attention = AttentionController(client: client, storage: storage);
      final task = TaskDetailController(
        taskId: 'T-1',
        client: client,
        storage: storage,
      );
      final live = LiveUpdatesController(client: client, storage: storage);
      final navigatorKey = GlobalKey<NavigatorState>();
      await tester.pumpWidget(
        MaterialApp(navigatorKey: navigatorKey, home: const SizedBox.shrink()),
      );
      unawaited(
        navigatorKey.currentState!.push<void>(
          MaterialPageRoute<void>(builder: (_) => const Text('Task detail')),
        ),
      );
      await tester.pumpAndSettle();
      final coordinator = CompanionConnectionCoordinator(
        projectBoardController: board,
        attentionController: attention,
        liveUpdatesController: live,
        navigatorKey: navigatorKey,
        initialState: const Connected(hostId: 'host-1', protocolVersion: 1),
      );
      addTearDown(pairing.dispose);
      addTearDown(board.dispose);
      addTearDown(attention.dispose);
      addTearDown(task.dispose);
      addTearDown(coordinator.dispose);

      coordinator.update(pairingController: pairing);
      coordinator.setOpenTask(task);
      coordinator.resume();
      await tester.pump();
      expect(client.liveConnectionCount, 1);

      pairing.liveUnavailable();
      await tester.pump();
      await tester.pump();

      expect(navigatorKey.currentState!.canPop(), isFalse);
      expect(board.state, isA<ProjectBoardLoading>());
      expect(attention.state, isA<AttentionLoading>());
      expect(task.state, isA<TaskDetailLoading>());
      expect(client.closedConnectionCount, 1);
    },
  );
}

final class _LifecycleClient implements CompanionClient {
  var liveConnectionCount = 0;
  var closedConnectionCount = 0;

  @override
  Future<CompanionHostConnection> fetchHostStatus(
    CompanionTrustRecord trustRecord,
  ) async => CompanionHostConnection(
    endpoint: trustRecord.endpointCandidates.single,
    status: HostStatus(
      hostId: trustRecord.hostId,
      protocolVersion: 1,
      serverTime: DateTime.utc(2026, 1, 1),
    ),
  );

  @override
  Future<CompanionLiveConnection> openLiveEvents(
    CompanionTrustRecord trustRecord, {
    String? lastEventId,
  }) async {
    liveConnectionCount += 1;
    return _LifecycleConnection(() => closedConnectionCount += 1);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) =>
      throw UnsupportedError('Client method was not expected.');
}

final class _LifecycleConnection implements CompanionLiveConnection {
  _LifecycleConnection(this._onClose);

  final void Function() _onClose;
  var _closed = false;
  final _events = StreamController<CompanionLiveEvent>();

  @override
  Stream<CompanionLiveEvent> get events => _events.stream;

  @override
  Future<void> close() async {
    if (_closed) return;
    _closed = true;
    _onClose();
    await _events.close();
  }
}

final class _ProjectStorage implements CompanionProjectStorage {
  _ProjectStorage(this.record);

  CompanionTrustRecord? record;

  @override
  Future<void> clearSelectedProject(String hostId) async {}

  @override
  Future<void> forget() async => record = null;

  @override
  Future<CompanionTrustRecord?> load() async => record;

  @override
  Future<String?> loadSelectedProject(String hostId) async => null;

  @override
  Future<void> save(CompanionTrustRecord record) async => this.record = record;

  @override
  Future<void> saveSelectedProject(String hostId, String projectId) async {}
}
