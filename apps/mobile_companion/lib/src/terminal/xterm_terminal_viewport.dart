part of 'xterm_terminal_adapter.dart';

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
  final _viewportCoordinator = _ResponsiveTerminalViewportCoordinator();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void didChangeMetrics() {
    _viewportCoordinator.restoreManualScrollOffset(isMounted: () => mounted);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _viewportCoordinator.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    _viewportCoordinator.updateKeyboardVisibility(
      visible: View.of(context).viewInsets.bottom > 0,
      dimensions: widget.adapter.dimensions,
    );

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
                  _viewportCoordinator.preserveKeyboardGeometry(
                    constraints.maxWidth,
                    resizeViewport: widget.adapter.resizeViewport,
                    isMounted: () => mounted,
                  );
                  return Semantics(
                    label: 'Agent terminal input',
                    textField: true,
                    enabled: enabled,
                    child: xterm.TerminalView(
                      widget.adapter.terminal,
                      readOnly: !enabled,
                      autofocus: false,
                      autoResize: !_viewportCoordinator.keyboardVisible,
                      scrollController: _viewportCoordinator.scrollController,
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
                onEscape: widget.adapter.sendEscape,
                onToggleControl: widget.adapter.toggleControl,
                onTab: widget.adapter.sendTab,
                onArrow: widget.adapter.sendArrow,
              ),
            ),
          ],
        );
      },
    );
  }
}

final class _ResponsiveTerminalViewportCoordinator {
  static const _terminalHorizontalPadding = 16.0;
  static const _bottomTolerance = 1.0;

  final scrollController = ScrollController();
  double? _layoutWidth;
  TerminalDimensions? _keyboardDimensions;
  bool keyboardVisible = false;

  void updateKeyboardVisibility({
    required bool visible,
    required TerminalDimensions dimensions,
  }) {
    if (visible && !keyboardVisible) {
      _keyboardDimensions = dimensions;
    } else if (!visible && keyboardVisible) {
      _keyboardDimensions = null;
    }
    keyboardVisible = visible;
  }

  void restoreManualScrollOffset({required bool Function() isMounted}) {
    if (!scrollController.hasClients) return;
    final position = scrollController.position;
    final distanceFromBottom = position.maxScrollExtent - position.pixels;
    if (distanceFromBottom <= _bottomTolerance) return;
    final manualOffset = position.pixels;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (!isMounted() || !scrollController.hasClients) return;
        final restored = manualOffset.clamp(
          scrollController.position.minScrollExtent,
          scrollController.position.maxScrollExtent,
        );
        scrollController.jumpTo(restored);
      });
    });
  }

  void preserveKeyboardGeometry(
    double width, {
    required void Function(TerminalDimensions dimensions) resizeViewport,
    required bool Function() isMounted,
  }) {
    final previousWidth = _layoutWidth;
    _layoutWidth = width;
    final dimensions = _keyboardDimensions;
    if (!keyboardVisible ||
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
      if (isMounted() && keyboardVisible) resizeViewport(resized);
    });
  }

  void dispose() => scrollController.dispose();
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
