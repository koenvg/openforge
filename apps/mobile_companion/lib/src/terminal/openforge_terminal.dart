import 'dart:typed_data';

import 'companion_terminal_protocol.dart';

abstract interface class OpenForgeTerminal {
  TerminalDimensions get dimensions;

  void writeOutput(Uint8List output);

  void clear();

  void dispose();
}
