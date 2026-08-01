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

enum TerminalArrow { left, up, down, right }

final class XtermOpenForgeTerminal implements OpenForgeTerminal {
  factory XtermOpenForgeTerminal({
    void Function(Uint8List)? onInput,
    void Function(TerminalDimensions)? onResize,
  }) => XtermOpenForgeTerminal._(onInput, onResize);

  XtermOpenForgeTerminal._(this._onInput, this._onResize) {
    terminal = xterm.Terminal(
      maxLines: 2000,
      onOutput: _emitInput,
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

  final void Function(Uint8List)? _onInput;
  final void Function(TerminalDimensions)? _onResize;
  final ValueNotifier<bool> controlArmed = ValueNotifier<bool>(false);
  late final xterm.Terminal terminal;
  late IncrementalTerminalUtf8Decoder _decoder;

  @override
  TerminalDimensions get dimensions => TerminalDimensions(
    columns: terminal.viewWidth,
    rows: terminal.viewHeight,
  );

  @override
  void writeOutput(Uint8List output) => _decoder.add(output);

  void paste(String text) => terminal.paste(text);

  void sendEscape() => terminal.keyInput(xterm.TerminalKey.escape);

  void sendTab() => terminal.keyInput(xterm.TerminalKey.tab);

  void sendArrow(TerminalArrow arrow) => terminal.keyInput(switch (arrow) {
    TerminalArrow.left => xterm.TerminalKey.arrowLeft,
    TerminalArrow.up => xterm.TerminalKey.arrowUp,
    TerminalArrow.down => xterm.TerminalKey.arrowDown,
    TerminalArrow.right => xterm.TerminalKey.arrowRight,
  });

  void toggleControl() => controlArmed.value = !controlArmed.value;

  void _emitInput(String data) {
    if (data.isEmpty) return;
    var input = data;
    if (controlArmed.value) {
      controlArmed.value = false;
      input = _controlInput(data);
    }
    for (final frame in encodeTerminalInputFrames(input)) {
      _onInput?.call(frame);
    }
  }

  String _controlInput(String input) {
    final runes = input.runes.toList(growable: false);
    if (runes.length != 1) return input;
    final rune = runes.single;
    if (rune >= 0x61 && rune <= 0x7a) {
      return String.fromCharCode(rune - 0x60);
    }
    if (rune >= 0x40 && rune <= 0x5f) {
      return String.fromCharCode(rune & 0x1f);
    }
    if (rune == 0x20) return '\x00';
    return input;
  }

  @override
  void clear() {
    controlArmed.value = false;
    _decoder.reset();
    terminal.mainBuffer.clear();
    terminal.altBuffer.clear();
    terminal.write('\x1b[2J\x1b[H');
  }

  @override
  void dispose() {
    _decoder.dispose();
    controlArmed.dispose();
  }
}

class OpenForgeTerminalView extends StatelessWidget {
  const OpenForgeTerminalView({
    required this.adapter,
    required this.inputState,
    required this.isInputEnabled,
    super.key,
  });

  final XtermOpenForgeTerminal adapter;
  final Listenable inputState;
  final bool Function() isInputEnabled;

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
    animation: inputState,
    builder: (context, _) {
      final enabled = isInputEnabled();
      final brightness = Theme.of(context).brightness;
      return Column(
        children: <Widget>[
          Expanded(
            child: Semantics(
              label: 'Agent terminal input',
              textField: true,
              enabled: enabled,
              child: xterm.TerminalView(
                adapter.terminal,
                readOnly: !enabled,
                autofocus: false,
                deleteDetection: true,
                simulateScroll: false,
                padding: const EdgeInsets.all(8),
                textStyle: const xterm.TerminalStyle(fontSize: 13),
                textScaler: MediaQuery.textScalerOf(context),
                keyboardAppearance: brightness,
                theme: brightness == Brightness.dark
                    ? _darkTerminalTheme
                    : _lightTerminalTheme,
              ),
            ),
          ),
          ValueListenableBuilder<bool>(
            valueListenable: adapter.controlArmed,
            builder: (context, controlArmed, _) => _TerminalAccessoryRow(
              enabled: enabled,
              controlArmed: controlArmed,
              adapter: adapter,
            ),
          ),
        ],
      );
    },
  );
}

final class _TerminalAccessoryRow extends StatelessWidget {
  const _TerminalAccessoryRow({
    required this.enabled,
    required this.controlArmed,
    required this.adapter,
  });

  final bool enabled;
  final bool controlArmed;
  final XtermOpenForgeTerminal adapter;

  @override
  Widget build(BuildContext context) => Material(
    color: Theme.of(context).colorScheme.surfaceContainer,
    child: SafeArea(
      top: false,
      minimum: const EdgeInsets.all(4),
      child: SizedBox(
        height: 48,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: <Widget>[
              _key(
                context,
                label: 'Escape key',
                child: const Text('Esc'),
                onPressed: adapter.sendEscape,
              ),
              _key(
                context,
                label: 'Control modifier, ${controlArmed ? 'on' : 'off'}',
                selected: controlArmed,
                child: const Text('Ctrl'),
                onPressed: adapter.toggleControl,
              ),
              _key(
                context,
                label: 'Tab key',
                child: const Text('Tab'),
                onPressed: adapter.sendTab,
              ),
              _arrow(
                context,
                'Left arrow key',
                Icons.arrow_back,
                TerminalArrow.left,
              ),
              _arrow(
                context,
                'Up arrow key',
                Icons.arrow_upward,
                TerminalArrow.up,
              ),
              _arrow(
                context,
                'Down arrow key',
                Icons.arrow_downward,
                TerminalArrow.down,
              ),
              _arrow(
                context,
                'Right arrow key',
                Icons.arrow_forward,
                TerminalArrow.right,
              ),
            ],
          ),
        ),
      ),
    ),
  );

  Widget _arrow(
    BuildContext context,
    String label,
    IconData icon,
    TerminalArrow arrow,
  ) => _key(
    context,
    label: label,
    child: Icon(icon, size: 20),
    onPressed: () => adapter.sendArrow(arrow),
  );

  Widget _key(
    BuildContext context, {
    required String label,
    required Widget child,
    required VoidCallback onPressed,
    bool selected = false,
  }) => SizedBox.square(
    dimension: 48,
    child: Semantics(
      label: label,
      button: true,
      enabled: enabled,
      selected: selected,
      excludeSemantics: true,
      child: TextButton(
        onPressed: enabled ? onPressed : null,
        style: TextButton.styleFrom(
          minimumSize: const Size.square(48),
          fixedSize: const Size.square(48),
          padding: EdgeInsets.zero,
          tapTargetSize: MaterialTapTargetSize.shrinkWrap,
          backgroundColor: selected
              ? Theme.of(context).colorScheme.secondaryContainer
              : null,
        ),
        child: child,
      ),
    ),
  );
}

const _darkTerminalTheme = xterm.TerminalTheme(
  cursor: Colors.white,
  selection: Colors.blueGrey,
  foreground: Colors.white,
  background: Colors.black,
  black: Colors.black,
  red: Colors.redAccent,
  green: Colors.lightGreenAccent,
  yellow: Colors.yellowAccent,
  blue: Colors.lightBlueAccent,
  magenta: Colors.purpleAccent,
  cyan: Colors.cyanAccent,
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

final _lightTerminalTheme = xterm.TerminalTheme(
  cursor: Colors.black,
  selection: Colors.blue.shade200,
  foreground: Colors.black,
  background: Colors.white,
  black: Colors.black,
  red: Colors.red.shade800,
  green: Colors.green.shade800,
  yellow: Colors.brown.shade700,
  blue: Colors.blue.shade800,
  magenta: Colors.purple.shade800,
  cyan: Colors.cyan.shade900,
  white: Colors.grey.shade700,
  brightBlack: Colors.grey.shade700,
  brightRed: Colors.red.shade700,
  brightGreen: Colors.green.shade800,
  brightYellow: Colors.brown.shade600,
  brightBlue: Colors.blue.shade700,
  brightMagenta: Colors.purple.shade700,
  brightCyan: Colors.cyan.shade800,
  brightWhite: Colors.black,
  searchHitBackground: Colors.yellow.shade300,
  searchHitBackgroundCurrent: Colors.amber.shade400,
  searchHitForeground: Colors.black,
);
