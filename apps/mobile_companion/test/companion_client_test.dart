import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/companion_client.dart';

final class _FakeCompanionClient implements CompanionClient {
  final CompanionHostStatus status = const CompanionHostStatus(
    hostId: 'desktop-1',
    protocolVersion: 1,
  );

  final Stream<CompanionEvent> events = Stream<CompanionEvent>.fromIterable(
    const <CompanionEvent>[CompanionEvent.attentionChanged],
  );

  @override
  Future<CompanionHostStatus> fetchHostStatus() async => status;

  @override
  Stream<CompanionEvent> watchEvents() => events;
}

void main() {
  test('one client seam covers generated calls and event streaming', () async {
    final client = _FakeCompanionClient();

    expect((await client.fetchHostStatus()).protocolVersion, 1);
    expect(await client.watchEvents().single, CompanionEvent.attentionChanged);
  });
}
