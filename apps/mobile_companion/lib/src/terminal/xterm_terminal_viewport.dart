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
    if (!mounted) return;
    _viewportCoordinator.updateKeyboardVisibility(
      visible: View.of(context).viewInsets.bottom > 0,
      dimensions: widget.adapter.dimensions,
    );
    setState(() {});
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
                      theme: quietPaperTerminalTheme(context),
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
