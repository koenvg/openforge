import 'dart:convert';
import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/app.dart';
import 'package:openforge_companion/src/terminal/companion_terminal_protocol.dart';
import 'package:openforge_companion/src/terminal/xterm_terminal_adapter.dart';
import 'package:xterm/xterm.dart' show TerminalKey, TerminalView;

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

  test('xterm input, paste, accessory keys, and one-shot Ctrl use UTF-8', () {
    final input = <Uint8List>[];
    final adapter = XtermOpenForgeTerminal(onInput: input.add);

    adapter.terminal.textInput('hé');
    adapter.terminal.keyInput(TerminalKey.enter);
    adapter.terminal.keyInput(TerminalKey.backspace);
    adapter.terminal.write('\x1b[?2004h');
    adapter.paste('one\ntwo');
    adapter.sendEscape();
    adapter.sendTab();
    adapter.sendArrow(TerminalArrow.up);
    adapter.toggleControl();
    expect(adapter.controlArmed.value, isTrue);
    adapter.terminal.textInput('c');

    expect(input.map(utf8.decode), <String>[
      'hé',
      '\r',
      '\x7f',
      '\x1b[200~one\ntwo\x1b[201~',
      '\x1b',
      '\t',
      '\x1b[A',
      '\x03',
    ]);
    expect(adapter.controlArmed.value, isFalse);

    adapter.toggleControl();
    adapter.clear();
    expect(adapter.controlArmed.value, isFalse);
    input.clear();
    adapter.terminal.textInput('c');
    expect(utf8.decode(input.single), 'c');

    adapter.dispose();
  });

  test('terminal input is chunked into valid UTF-8 protocol frames', () {
    final frames = <Uint8List>[];
    final adapter = XtermOpenForgeTerminal(onInput: frames.add);

    void expectFrames(String input, List<int> lengths) {
      frames.clear();
      adapter.terminal.textInput(input);
      expect(frames.map((frame) => frame.length), lengths);
      for (final frame in frames) {
        expect(frame.length, lessThanOrEqualTo(terminalFrameMaxBytes));
        expect(() => utf8.decode(frame), returnsNormally);
      }
      expect(utf8.decode(frames.expand((frame) => frame).toList()), input);
    }

    expectFrames('a' * terminalFrameMaxBytes, <int>[terminalFrameMaxBytes]);
    expectFrames('a' * (terminalFrameMaxBytes + 1), <int>[
      terminalFrameMaxBytes,
      1,
    ]);
    expectFrames('${'a' * (terminalFrameMaxBytes - 1)}é', <int>[
      terminalFrameMaxBytes - 1,
      2,
    ]);

    adapter.dispose();
  });

  test(
    'terminal mouse reporting and OSC 52 clipboard output stay disabled',
    () {
      final input = <Uint8List>[];
      final adapter = XtermOpenForgeTerminal(onInput: input.add);

      expect(adapter.terminal.mouseHandler, isNull);
      adapter.terminal.write('\x1b]52;c;cmVtb3RlLWNsaXBib2FyZA==\x07');
      expect(input, isEmpty);

      adapter.dispose();
    },
  );

  testWidgets('terminal follows system brightness and labels every accessory', (
    tester,
  ) async {
    final enabled = ValueNotifier<bool>(true);
    final input = <Uint8List>[];
    final adapter = XtermOpenForgeTerminal(onInput: input.add);

    Future<void> pump(Brightness brightness) async {
      await tester.pumpWidget(
        MaterialApp(
          theme: ThemeData(brightness: brightness),
          themeMode: ThemeMode.light,
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(
              context,
            ).copyWith(textScaler: TextScaler.linear(1.4)),
            child: child!,
          ),
          home: Scaffold(
            body: OpenForgeTerminalView(
              adapter: adapter,
              inputState: enabled,
              isInputEnabled: () => enabled.value,
            ),
          ),
        ),
      );
      await tester.pumpAndSettle();
    }

    await pump(Brightness.light);
    expect(find.bySemanticsLabel('Agent terminal input'), findsOneWidget);
    for (final label in <String>[
      'Escape key',
      'Control modifier, off',
      'Tab key',
      'Left arrow key',
      'Up arrow key',
      'Down arrow key',
      'Right arrow key',
    ]) {
      expect(find.bySemanticsLabel(label), findsOneWidget);
    }
    final lightView = tester.widget<TerminalView>(find.byType(TerminalView));
    expect(lightView.keyboardAppearance, Brightness.light);
    expect(lightView.theme.background, Colors.white);
    expect(lightView.readOnly, isFalse);
    expect(lightView.simulateScroll, isFalse);
    expect(lightView.textStyle.fontSize, 13);
    expect(lightView.textScaler?.scale(10), 14);
    final accessoryButtons = find.byType(TextButton);
    expect(accessoryButtons, findsNWidgets(7));
    for (var index = 0; index < 7; index += 1) {
      final size = tester.getSize(accessoryButtons.at(index));
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));
    }

    await pump(Brightness.dark);
    final darkView = tester.widget<TerminalView>(find.byType(TerminalView));
    expect(darkView.keyboardAppearance, Brightness.dark);
    expect(darkView.theme.background, Colors.black);

    await tester.tap(find.bySemanticsLabel('Escape key'));
    expect(utf8.decode(input.single), '\x1b');

    enabled.value = false;
    await tester.pump();
    final escape = tester.widget<TextButton>(
      find.ancestor(of: find.text('Esc'), matching: find.byType(TextButton)),
    );
    expect(escape.onPressed, isNull);
    expect(
      tester.widget<TerminalView>(find.byType(TerminalView)).readOnly,
      isTrue,
    );

    adapter.dispose();
    enabled.dispose();
  });

  testWidgets(
    'usable xterm grid resizes for orientation and software-keyboard geometry',
    (tester) async {
      final enabled = ValueNotifier<bool>(true);
      final grids = <({int columns, int rows})>[];
      final adapter = XtermOpenForgeTerminal(
        onResize: (size) => grids.add((columns: size.columns, rows: size.rows)),
      );

      Future<({int columns, int rows})> pumpGrid(
        double width,
        double height,
      ) async {
        await tester.pumpWidget(
          MaterialApp(
            home: Scaffold(
              body: Center(
                child: SizedBox(
                  width: width,
                  height: height,
                  child: OpenForgeTerminalView(
                    adapter: adapter,
                    inputState: enabled,
                    isInputEnabled: () => enabled.value,
                  ),
                ),
              ),
            ),
          ),
        );
        await tester.pumpAndSettle();
        return grids.last;
      }

      final portrait = await pumpGrid(320, 560);
      final landscape = await pumpGrid(560, 280);
      final keyboardVisible = await pumpGrid(560, 160);

      expect(landscape.columns, greaterThan(portrait.columns));
      expect(landscape.rows, lessThan(portrait.rows));
      expect(keyboardVisible.columns, landscape.columns);
      expect(keyboardVisible.rows, lessThan(landscape.rows));

      adapter.dispose();
      enabled.dispose();
    },
  );

  testWidgets('Companion app follows the system theme mode', (tester) async {
    await tester.pumpWidget(const CompanionApp());

    final app = tester.widget<MaterialApp>(find.byType(MaterialApp));
    expect(app.themeMode, ThemeMode.system);
    expect(app.theme?.brightness, Brightness.light);
    expect(app.darkTheme?.brightness, Brightness.dark);
  });
}
