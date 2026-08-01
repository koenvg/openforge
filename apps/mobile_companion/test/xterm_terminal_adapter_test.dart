import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/terminal/xterm_terminal_adapter.dart';

void main() {
  test('OpenForge xterm adapter decodes UTF-8 incrementally across frames', () {
    final output = StringBuffer();
    final decoder = IncrementalTerminalUtf8Decoder(output.write);

    decoder.add(Uint8List.fromList(<int>[0x68, 0xc3]));
    expect(output.toString(), 'h');

    decoder.add(Uint8List.fromList(<int>[0xa9, 0x21]));
    expect(output.toString(), 'hé!');

    decoder.dispose();
  });
}
