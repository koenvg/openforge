import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'companion_terminal_protocol.dart';
import 'openforge_terminal.dart';

final class IncrementalTerminalUtf8Decoder {
  IncrementalTerminalUtf8Decoder(this._onText) {
    _resetSink();
  }

  final void Function(String text) _onText;
  late ByteConversionSink _sink;

  void add(Uint8List bytes) => _sink.add(bytes);

  void reset() => _resetSink();

  void dispose() {
    try {
      _sink.close();
    } on FormatException {
      // A disconnected frame may end midway through a code point. It is discarded.
    }
  }

  void _resetSink() {
    _sink = const Utf8Decoder(allowMalformed: false).startChunkedConversion(
      StringConversionSink.fromStringSink(_CallbackStringSink(_onText)),
    );
  }
}

final class _CallbackStringSink implements StringSink {
  const _CallbackStringSink(this.onText);

  final void Function(String text) onText;

  @override
  void write(Object? object) => onText(object?.toString() ?? '');

  @override
  void writeAll(Iterable<Object?> objects, [String separator = '']) =>
      onText(objects.join(separator));

  @override
  void writeCharCode(int charCode) => onText(String.fromCharCode(charCode));

  @override
  void writeln([Object? object = '']) => onText('${object ?? ''}\n');
}

final class XtermOpenForgeTerminal implements OpenForgeTerminal {
  factory XtermOpenForgeTerminal({
    void Function(TerminalDimensions)? onResize,
  }) => XtermOpenForgeTerminal._(onResize);

  XtermOpenForgeTerminal._(this._onResize) {
    terminal = xterm.Terminal(
      maxLines: 2000,
      onOutput: null,
      mouseHandler: null,
      onPrivateOSC: (_, _) {},
    );
    terminal.onResize = (columns, rows, _, _) {
      if (columns > 0 && rows > 0) {
        _onResize?.call(TerminalDimensions(columns: columns, rows: rows));
      }
    };
    _decoder = IncrementalTerminalUtf8Decoder(terminal.write);
  }

  final void Function(TerminalDimensions)? _onResize;
  late final xterm.Terminal terminal;
  late IncrementalTerminalUtf8Decoder _decoder;

  @override
  TerminalDimensions get dimensions => TerminalDimensions(
    columns: terminal.viewWidth,
    rows: terminal.viewHeight,
  );

  @override
  void writeOutput(Uint8List output) => _decoder.add(output);

  @override
  void clear() {
    _decoder.reset();
    terminal.mainBuffer.clear();
    terminal.altBuffer.clear();
    terminal.write('\x1b[2J\x1b[H');
  }

  @override
  void dispose() {
    _decoder.dispose();
  }
}

class OpenForgeTerminalView extends StatelessWidget {
  const OpenForgeTerminalView({required this.adapter, super.key});

  final XtermOpenForgeTerminal adapter;

  @override
  Widget build(BuildContext context) => xterm.TerminalView(
    adapter.terminal,
    readOnly: true,
    autofocus: false,
    simulateScroll: false,
    padding: const EdgeInsets.all(8),
    textStyle: const xterm.TerminalStyle(fontSize: 13),
    theme: Theme.of(context).brightness == Brightness.dark
        ? _darkTerminalTheme
        : _lightTerminalTheme,
  );
}

const _darkTerminalTheme = xterm.TerminalTheme(
  cursor: Colors.white,
  selection: Colors.blueGrey,
  foreground: Colors.white,
  background: Colors.black,
  black: Colors.black,
  red: Colors.red,
  green: Colors.green,
  yellow: Colors.yellow,
  blue: Colors.blue,
  magenta: Colors.purple,
  cyan: Colors.cyan,
  white: Colors.white,
  brightBlack: Colors.grey,
  brightRed: Colors.redAccent,
  brightGreen: Colors.lightGreenAccent,
  brightYellow: Colors.yellowAccent,
  brightBlue: Colors.lightBlueAccent,
  brightMagenta: Colors.purpleAccent,
  brightCyan: Colors.cyanAccent,
  brightWhite: Colors.white,
  searchHitBackground: Colors.yellow,
  searchHitBackgroundCurrent: Colors.amber,
  searchHitForeground: Colors.black,
);

const _lightTerminalTheme = xterm.TerminalTheme(
  cursor: Colors.black,
  selection: Colors.blueGrey,
  foreground: Colors.black,
  background: Colors.white,
  black: Colors.black,
  red: Colors.red,
  green: Colors.green,
  yellow: Colors.orange,
  blue: Colors.blue,
  magenta: Colors.purple,
  cyan: Colors.cyan,
  white: Colors.white,
  brightBlack: Colors.grey,
  brightRed: Colors.redAccent,
  brightGreen: Colors.lightGreen,
  brightYellow: Colors.amber,
  brightBlue: Colors.lightBlue,
  brightMagenta: Colors.purpleAccent,
  brightCyan: Colors.cyan,
  brightWhite: Colors.white,
  searchHitBackground: Colors.yellow,
  searchHitBackgroundCurrent: Colors.amber,
  searchHitForeground: Colors.black,
);
