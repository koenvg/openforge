import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'companion_terminal_protocol.dart';
import 'openforge_terminal.dart';

part 'xterm_terminal_accessory_row.dart';
part 'xterm_terminal_viewport.dart';

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
