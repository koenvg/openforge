import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'companion_terminal_protocol.dart';
import 'openforge_terminal.dart';

const _terminalOutputBatchDelay = Duration(milliseconds: 16);
const _terminalOutputBatchMaxBytes = 256 * 1024;

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
        if (!_layoutReady.isCompleted) _layoutReady.complete();
        _onResize?.call(TerminalDimensions(columns: columns, rows: rows));
      }
    };
    _decoder = IncrementalTerminalUtf8Decoder(terminal.write);
  }

  final void Function(Uint8List)? _onInput;
  final void Function(TerminalDimensions)? _onResize;
  final _layoutReady = Completer<void>();
  final ValueNotifier<bool> controlArmed = ValueNotifier<bool>(false);
  late final xterm.Terminal terminal;
  late IncrementalTerminalUtf8Decoder _decoder;
  var _pendingOutput = BytesBuilder(copy: false);
  Timer? _outputFlushTimer;
  void Function(FormatException error)? _outputErrorHandler;

  @override
  Future<void> get layoutReady => _layoutReady.future;
  @override
  TerminalDimensions get dimensions => TerminalDimensions(
    columns: terminal.viewWidth,
    rows: terminal.viewHeight,
  );

  @override
  void writeOutput(Uint8List output) {
    var offset = 0;
    while (offset < output.length) {
      final capacity = _terminalOutputBatchMaxBytes - _pendingOutput.length;
      final remaining = output.length - offset;
      final chunkLength = remaining < capacity ? remaining : capacity;
      _pendingOutput.add(
        Uint8List.sublistView(output, offset, offset + chunkLength),
      );
      offset += chunkLength;
      if (_pendingOutput.length == _terminalOutputBatchMaxBytes) {
        flushOutput();
      }
    }
    if (_pendingOutput.isNotEmpty) {
      _outputFlushTimer ??= Timer(
        _terminalOutputBatchDelay,
        _flushOutputOnTimer,
      );
    }
  }

  @override
  void flushOutput() {
    _outputFlushTimer?.cancel();
    _outputFlushTimer = null;
    if (_pendingOutput.isEmpty) return;
    _decoder.add(_pendingOutput.takeBytes());
  }

  @override
  set outputErrorHandler(void Function(FormatException error)? handler) {
    _outputErrorHandler = handler;
  }

  void _flushOutputOnTimer() {
    try {
      flushOutput();
    } on FormatException catch (error) {
      final handler = _outputErrorHandler;
      if (handler == null) rethrow;
      handler(error);
    }
  }

  void resizeViewport(TerminalDimensions dimensions) {
    terminal.resize(dimensions.columns, dimensions.rows);
  }

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
    _discardPendingOutput();
    _decoder.reset();
    terminal.mainBuffer.clear();
    terminal.altBuffer.clear();
    terminal.write('\x1b[2J\x1b[H');
  }

  @override
  void dispose() {
    _outputErrorHandler = null;
    _discardPendingOutput();
    _decoder.dispose();
    controlArmed.dispose();
  }

  void _discardPendingOutput() {
    _outputFlushTimer?.cancel();
    _outputFlushTimer = null;
    _pendingOutput = BytesBuilder(copy: false);
  }
}

class OpenForgeTerminalView extends StatefulWidget {
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
  State<OpenForgeTerminalView> createState() => _OpenForgeTerminalViewState();
}

class _OpenForgeTerminalViewState extends State<OpenForgeTerminalView>
    with WidgetsBindingObserver {
  static const _terminalHorizontalPadding = 16.0;
  static const _bottomTolerance = 1.0;

  final _scrollController = ScrollController();
  double? _layoutWidth;
  TerminalDimensions? _keyboardDimensions;
  var _keyboardVisible = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeMetrics() {
    if (!_scrollController.hasClients) return;
    final position = _scrollController.position;
    final distanceFromBottom = position.maxScrollExtent - position.pixels;
    if (distanceFromBottom <= _bottomTolerance) return;
    final manualOffset = position.pixels;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!mounted || !_scrollController.hasClients) return;
        final restored = manualOffset.clamp(
          _scrollController.position.minScrollExtent,
          _scrollController.position.maxScrollExtent,
        );
        _scrollController.jumpTo(restored);
      });
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final keyboardVisible = View.of(context).viewInsets.bottom > 0;
    if (keyboardVisible && !_keyboardVisible) {
      _keyboardDimensions = widget.adapter.dimensions;
    } else if (!keyboardVisible && _keyboardVisible) {
      _keyboardDimensions = null;
    }
    _keyboardVisible = keyboardVisible;

    return AnimatedBuilder(
      animation: widget.inputState,
      builder: (context, _) {
        final enabled = widget.isInputEnabled();
        final brightness = Theme.of(context).brightness;
        return Column(
          children: <Widget>[
            Expanded(
              child: LayoutBuilder(
                builder: (context, constraints) {
                  _preserveKeyboardGeometry(constraints.maxWidth);
                  return Semantics(
                    label: 'Agent terminal input',
                    textField: true,
                    enabled: enabled,
                    child: xterm.TerminalView(
                      widget.adapter.terminal,
                      readOnly: !enabled,
                      autofocus: false,
                      autoResize: !keyboardVisible,
                      scrollController: _scrollController,
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
                  );
                },
              ),
            ),
            ValueListenableBuilder<bool>(
              valueListenable: widget.adapter.controlArmed,
              builder: (context, controlArmed, _) => _TerminalAccessoryRow(
                enabled: enabled,
                controlArmed: controlArmed,
                adapter: widget.adapter,
              ),
            ),
          ],
        );
      },
    );
  }

  void _preserveKeyboardGeometry(double width) {
    final previousWidth = _layoutWidth;
    _layoutWidth = width;
    final dimensions = _keyboardDimensions;
    if (!_keyboardVisible ||
        dimensions == null ||
        previousWidth == null ||
        previousWidth == width) {
      return;
    }
    final previousContentWidth = previousWidth - _terminalHorizontalPadding;
    final contentWidth = width - _terminalHorizontalPadding;
    if (previousContentWidth <= 0 || contentWidth <= 0) return;
    final columns = (dimensions.columns * contentWidth / previousContentWidth)
        .floor()
        .clamp(1, 1000);
    final resized = TerminalDimensions(columns: columns, rows: dimensions.rows);
    _keyboardDimensions = resized;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && _keyboardVisible) widget.adapter.resizeViewport(resized);
    });
  }
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
