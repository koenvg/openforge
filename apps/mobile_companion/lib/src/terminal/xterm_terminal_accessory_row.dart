part of 'xterm_terminal_adapter.dart';

final class _TerminalAccessoryRow extends StatelessWidget {
  const _TerminalAccessoryRow({
    required this.enabled,
    required this.controlArmed,
    required this.onEscape,
    required this.onToggleControl,
    required this.onTab,
    required this.onArrow,
  });

  final bool enabled;
  final bool controlArmed;
  final VoidCallback onEscape;
  final VoidCallback onToggleControl;
  final VoidCallback onTab;
  final void Function(TerminalArrow arrow) onArrow;

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
                onPressed: onEscape,
              ),
              _key(
                context,
                label: 'Control modifier, ${controlArmed ? 'on' : 'off'}',
                selected: controlArmed,
                child: const Text('Ctrl'),
                onPressed: onToggleControl,
              ),
              _key(
                context,
                label: 'Tab key',
                child: const Text('Tab'),
                onPressed: onTab,
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
    onPressed: () => onArrow(arrow),
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
