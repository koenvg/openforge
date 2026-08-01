import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_protocol.dart';

void main() {
  final fixtures =
      jsonDecode(
            File(
              '../../docs/contracts/companion-terminal-v1-fixtures.json',
            ).readAsStringSync(),
          )!
          as Map<String, Object?>;

  test('shared terminal controls decode in Dart', () {
    for (final raw in fixtures['valid']! as List<Object?>) {
      final fixture = raw! as Map<String, Object?>;
      final message = fixture['message']! as Map<String, Object?>;
      final decoded = switch (fixture['direction']) {
        'client' => ClientTerminalControl.decode(jsonEncode(message)),
        'server' => ServerTerminalControl.decode(jsonEncode(message)),
        final direction => throw StateError('Unknown direction $direction'),
      };
      expect(decoded, isNotNull, reason: fixture['name']! as String);
    }
  });

  test('shared invalid terminal controls are rejected in Dart', () {
    for (final raw in fixtures['invalid']! as List<Object?>) {
      final fixture = raw! as Map<String, Object?>;
      final message = fixture['message']! as Map<String, Object?>;
      Object decode() => switch (fixture['direction']) {
        'client' => ClientTerminalControl.decode(jsonEncode(message)),
        'server' => ServerTerminalControl.decode(jsonEncode(message)),
        final direction => throw StateError('Unknown direction $direction'),
      };
      expect(decode, throwsFormatException, reason: fixture['name']! as String);
    }
  });
}
