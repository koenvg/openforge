import 'package:flutter/material.dart';
import 'package:xterm/xterm.dart' as xterm;

import 'quiet_paper_theme.dart';

/// Builds the terminal palette for the active Quiet Paper appearance.
xterm.TerminalTheme quietPaperTerminalTheme(BuildContext context) {
  final theme = Theme.of(context);
  final colors =
      theme.extension<QuietPaperColors>() ??
      (theme.brightness == Brightness.dark
              ? QuietPaperTheme.dark
              : QuietPaperTheme.light)
          .extension<QuietPaperColors>()!;
  final ansi = theme.brightness == Brightness.dark ? _darkAnsi : _lightAnsi;
  return xterm.TerminalTheme(
    cursor: colors.terminalCursor,
    selection: colors.terminalSelection,
    foreground: colors.terminalForeground,
    background: colors.terminalCanvas,
    black: ansi.black,
    red: ansi.red,
    green: ansi.green,
    yellow: ansi.yellow,
    blue: ansi.blue,
    magenta: ansi.magenta,
    cyan: ansi.cyan,
    white: ansi.white,
    brightBlack: ansi.brightBlack,
    brightRed: ansi.brightRed,
    brightGreen: ansi.brightGreen,
    brightYellow: ansi.brightYellow,
    brightBlue: ansi.brightBlue,
    brightMagenta: ansi.brightMagenta,
    brightCyan: ansi.brightCyan,
    brightWhite: ansi.brightWhite,
    searchHitBackground: ansi.searchHitBackground,
    searchHitBackgroundCurrent: ansi.searchHitBackgroundCurrent,
    searchHitForeground: colors.terminalCanvas,
  );
}

final class _AnsiPalette {
  const _AnsiPalette({
    required this.black,
    required this.red,
    required this.green,
    required this.yellow,
    required this.blue,
    required this.magenta,
    required this.cyan,
    required this.white,
    required this.brightBlack,
    required this.brightRed,
    required this.brightGreen,
    required this.brightYellow,
    required this.brightBlue,
    required this.brightMagenta,
    required this.brightCyan,
    required this.brightWhite,
    required this.searchHitBackground,
    required this.searchHitBackgroundCurrent,
  });

  final Color black;
  final Color red;
  final Color green;
  final Color yellow;
  final Color blue;
  final Color magenta;
  final Color cyan;
  final Color white;
  final Color brightBlack;
  final Color brightRed;
  final Color brightGreen;
  final Color brightYellow;
  final Color brightBlue;
  final Color brightMagenta;
  final Color brightCyan;
  final Color brightWhite;
  final Color searchHitBackground;
  final Color searchHitBackgroundCurrent;
}

const _lightAnsi = _AnsiPalette(
  black: Color(0xFF000000),
  red: Color(0xFFC62828),
  green: Color(0xFF2E7D32),
  yellow: Color(0xFF5D4037),
  blue: Color(0xFF1565C0),
  magenta: Color(0xFF6A1B9A),
  cyan: Color(0xFF006064),
  white: Color(0xFF616161),
  brightBlack: Color(0xFF616161),
  brightRed: Color(0xFFD32F2F),
  brightGreen: Color(0xFF2E7D32),
  brightYellow: Color(0xFF6D4C41),
  brightBlue: Color(0xFF1976D2),
  brightMagenta: Color(0xFF7B1FA2),
  brightCyan: Color(0xFF00838F),
  brightWhite: Color(0xFF000000),
  searchHitBackground: Color(0xFFFFF176),
  searchHitBackgroundCurrent: Color(0xFFFFCA28),
);

const _darkAnsi = _AnsiPalette(
  black: Color(0xFF02060C),
  red: Color(0xFFFF858C),
  green: Color(0xFF83D7A6),
  yellow: Color(0xFFF0CA70),
  blue: Color(0xFF8FB2FF),
  magenta: Color(0xFFCBA8FF),
  cyan: Color(0xFF72D9E8),
  white: Color(0xFFE4EAF3),
  brightBlack: Color(0xFF7D899B),
  brightRed: Color(0xFFFFADB2),
  brightGreen: Color(0xFFB5F1CA),
  brightYellow: Color(0xFFFFE09B),
  brightBlue: Color(0xFFBFD0FF),
  brightMagenta: Color(0xFFE2CDFF),
  brightCyan: Color(0xFFA6EDF4),
  brightWhite: Color(0xFFFFFFFF),
  searchHitBackground: Color(0xFFF0CA70),
  searchHitBackgroundCurrent: Color(0xFFFFE09B),
);
