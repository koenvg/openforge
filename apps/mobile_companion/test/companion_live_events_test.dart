import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_live_events.dart';

void main() {
  test('SSE decoder exposes only typed coarse resource identities', () async {
    final events = await decodeCompanionSseLines(
      Stream<String>.fromIterable(<String>[
        'id: epoch:4',
        'event: resources-invalidated',
        'data: {"resources":[{"kind":"project_catalog"},{"kind":"project_board","id":"P-4"},{"kind":"attention"},{"kind":"task","id":"KVG-2947"}]}',
        '',
      ]),
    ).toList();

    final event = events.single as CompanionResourcesInvalidated;
    expect(event.eventId, 'epoch:4');
    expect(event.resources, hasLength(4));
    expect(event.resources[0].kind, CompanionResourceKind.projectCatalog);
    expect(event.resources[0].id, isNull);
    expect(event.resources[1].kind, CompanionResourceKind.projectBoard);
    expect(event.resources[1].id, 'P-4');
    expect(event.resources[2].kind, CompanionResourceKind.attention);
    expect(event.resources[3].kind, CompanionResourceKind.task);
    expect(event.resources[3].id, 'KVG-2947');
  });

  test(
    'SSE decoder rejects internal or expanded invalidation payloads',
    () async {
      await expectLater(
        decodeCompanionSseLines(
          Stream<String>.fromIterable(<String>[
            'id: epoch:5',
            'event: resources-invalidated',
            'data: {"resources":[{"kind":"task","id":"KVG-2947","provider":"codex"}]}',
            '',
          ]),
        ).toList(),
        throwsFormatException,
      );
    },
  );

  test('SSE decoder maps gap and terminal events to typed states', () async {
    final events = await decodeCompanionSseLines(
      Stream<String>.fromIterable(<String>[
        'id: epoch:9',
        'event: stream-gap',
        'data: {"refreshRequired":true}',
        '',
        'event: authorization-revoked',
        'data: {"reason":"revoked"}',
        '',
        'event: gateway-closing',
        'data: {"reason":"shutdown"}',
        '',
      ]),
    ).toList();

    expect(events[0], isA<CompanionStreamGap>());
    expect(events[0].eventId, 'epoch:9');
    expect(events[1], isA<CompanionAuthorizationRevoked>());
    expect(events[2], isA<CompanionGatewayClosing>());
  });

  test('SSE decoder rejects malformed or expanded control payloads', () async {
    for (final scenario in <({String event, String data})>[
      (event: 'stream-gap', data: '{"refreshRequired":false}'),
      (
        event: 'authorization-revoked',
        data: '{"reason":"revoked","deviceId":"secret"}',
      ),
      (event: 'gateway-closing', data: '{"reason":"restart"}'),
    ]) {
      await expectLater(
        decodeCompanionSseLines(
          Stream<String>.fromIterable(<String>[
            'id: epoch:10',
            'event: ${scenario.event}',
            'data: ${scenario.data}',
            '',
          ]),
        ).toList(),
        throwsFormatException,
      );
    }
  });
}
