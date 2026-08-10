import 'package:flutter/material.dart';

import '../generated/companion_v1_client.dart';
import 'project_board_controller.dart';

class TaskCreationSheet extends StatefulWidget {
  const TaskCreationSheet({required this.onCreate, super.key});

  final Future<TaskCreateResult> Function(String initialPrompt) onCreate;

  @override
  State<TaskCreationSheet> createState() => _TaskCreationSheetState();
}

class _TaskCreationSheetState extends State<TaskCreationSheet> {
  final _promptController = TextEditingController();
  bool _submitting = false;
  String? _error;

  bool get _canSubmit =>
      !_submitting && _promptController.text.trim().isNotEmpty;

  @override
  void dispose() {
    _promptController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_canSubmit) return;
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      final created = await widget.onCreate(_promptController.text);
      if (!mounted) return;
      Navigator.of(context).pop(created);
    } on TaskCreationFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = failure.message;
      });
    } on Object {
      if (!mounted) return;
      setState(() {
        _submitting = false;
        _error = 'Task could not be created. Try again.';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      top: false,
      child: SingleChildScrollView(
        padding: EdgeInsets.fromLTRB(
          24,
          20,
          24,
          24 + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text('Create Task', style: theme.textTheme.headlineSmall),
                const SizedBox(height: 8),
                Text(
                  'Add a Task to this Project’s Backlog. Desktop-saved Project defaults will be used when it starts.',
                  style: theme.textTheme.bodyMedium?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 20),
                TextField(
                  controller: _promptController,
                  autofocus: true,
                  enabled: !_submitting,
                  minLines: 5,
                  maxLines: 10,
                  maxLength: 64000,
                  textCapitalization: TextCapitalization.sentences,
                  textInputAction: TextInputAction.newline,
                  decoration: InputDecoration(
                    labelText: 'Task initial prompt',
                    alignLabelWithHint: true,
                    hintText: 'Describe what should be done…',
                    border: const OutlineInputBorder(),
                    errorText: _error,
                  ),
                  onChanged: (_) => setState(() {
                    if (_error != null) _error = null;
                  }),
                ),
                const SizedBox(height: 16),
                Row(
                  mainAxisAlignment: MainAxisAlignment.end,
                  children: <Widget>[
                    TextButton(
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
                    const SizedBox(width: 12),
                    FilledButton(
                      onPressed: _canSubmit ? _submit : null,
                      child: _submitting
                          ? const SizedBox.square(
                              dimension: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : const Text('Create Task'),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
