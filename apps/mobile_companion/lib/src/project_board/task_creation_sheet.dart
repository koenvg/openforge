import 'dart:async';

import 'package:flutter/material.dart';

import '../design_system/quiet_paper_theme.dart';

import '../generated/companion_v1_client.dart';
import 'project_board_controller.dart';

class TaskCreationSheet extends StatefulWidget {
  const TaskCreationSheet({
    required this.projectName,
    required this.loadPromptCatalog,
    required this.onCreate,
    super.key,
  });

  final String projectName;
  final Future<TaskPromptCatalog> Function() loadPromptCatalog;
  final Future<TaskCreateResult> Function(String initialPrompt) onCreate;

  @override
  State<TaskCreationSheet> createState() => _TaskCreationSheetState();
}

class _TaskCreationSheetState extends State<TaskCreationSheet> {
  final _promptController = TextEditingController();
  TaskPromptCatalog? _promptCatalog;
  Future<TaskPromptCatalog>? _promptCatalogLoad;
  List<TaskPromptSuggestion> _suggestions = const <TaskPromptSuggestion>[];
  bool _submitting = false;
  String? _error;

  bool get _canSubmit =>
      !_submitting && _promptController.text.trim().isNotEmpty;

  void _handlePromptChanged(String text) {
    setState(() {
      if (_error != null) _error = null;
      if (!_couldBePromptQuery(text)) {
        _suggestions = const <TaskPromptSuggestion>[];
      }
    });
    if (_couldBePromptQuery(text)) {
      unawaited(_loadAndFilterSuggestions(text));
    }
  }

  bool _couldBePromptQuery(String text) => RegExp(r'^[/$]\S*$').hasMatch(text);

  Future<void> _loadAndFilterSuggestions(String requestedText) async {
    try {
      final catalog =
          _promptCatalog ??
          await (_promptCatalogLoad ??= widget.loadPromptCatalog());
      _promptCatalog = catalog;
      if (!mounted || _promptController.text != requestedText) return;

      final matchesTrigger = requestedText.startsWith(catalog.trigger);
      final query = requestedText.substring(1).toLowerCase();
      setState(() {
        _suggestions = matchesTrigger
            ? catalog.suggestions
                  .where(
                    (suggestion) =>
                        suggestion.name.toLowerCase().contains(query),
                  )
                  .toList(growable: false)
            : const <TaskPromptSuggestion>[];
      });
    } on Object {
      _promptCatalogLoad = null;
      if (!mounted || _promptController.text != requestedText) return;
      setState(() {
        _suggestions = const <TaskPromptSuggestion>[];
      });
    }
  }

  void _selectSuggestion(TaskPromptSuggestion suggestion) {
    final catalog = _promptCatalog;
    if (catalog == null) return;
    final text = '${catalog.trigger}${suggestion.name} ';
    _promptController.value = TextEditingValue(
      text: text,
      selection: TextSelection.collapsed(offset: text.length),
    );
    setState(() {
      _suggestions = const <TaskPromptSuggestion>[];
    });
  }

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
          QuietPaperSpacing.gutter,
          QuietPaperSpacing.gutter,
          QuietPaperSpacing.gutter,
          QuietPaperSpacing.section + MediaQuery.viewInsetsOf(context).bottom,
        ),
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 640),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                Text('Create Task', style: theme.textTheme.headlineSmall),
                const SizedBox(height: QuietPaperSpacing.related),
                Text('Project', style: theme.textTheme.labelLarge),
                const SizedBox(height: QuietPaperSpacing.compact),
                DecoratedBox(
                  decoration: BoxDecoration(
                    color: theme.colorScheme.surfaceContainerLow,
                    border: Border.all(color: theme.colorScheme.outlineVariant),
                    borderRadius: BorderRadius.circular(
                      QuietPaperShapes.controlRadius,
                    ),
                  ),
                  child: Padding(
                    padding: const EdgeInsets.all(QuietPaperSpacing.related),
                    child: Row(
                      children: <Widget>[
                        Icon(
                          Icons.layers_outlined,
                          color: theme.colorScheme.primary,
                        ),
                        const SizedBox(width: QuietPaperSpacing.compact),
                        Expanded(
                          child: Text(
                            widget.projectName,
                            style: theme.textTheme.titleSmall,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(height: QuietPaperSpacing.related),
                Text(
                  'Creates a Task in Backlog using desktop-saved Project defaults.',
                  style: theme.textTheme.bodySmall,
                ),
                const SizedBox(height: QuietPaperSpacing.section),
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
                    labelText: 'What needs to be done?',
                    alignLabelWithHint: true,
                    hintText: 'Describe what should be done…',
                    border: const OutlineInputBorder(),
                    errorText: _error,
                  ),
                  onChanged: _handlePromptChanged,
                ),
                if (_suggestions.isNotEmpty) ...<Widget>[
                  const SizedBox(height: QuietPaperSpacing.compact),
                  Material(
                    color: theme.colorScheme.surfaceContainerLow,
                    shape: RoundedRectangleBorder(
                      side: BorderSide(color: theme.colorScheme.outlineVariant),
                      borderRadius: BorderRadius.circular(
                        QuietPaperShapes.controlRadius,
                      ),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxHeight: 240),
                      child: ListView.builder(
                        primary: false,
                        shrinkWrap: true,
                        itemCount: _suggestions.length,
                        itemBuilder: (context, index) {
                          final suggestion = _suggestions[index];
                          final description = suggestion.description?.trim();
                          final source = suggestion.source?.trim();
                          return ListTile(
                            leading: Icon(
                              suggestion.kind == TaskPromptSuggestionKind.skill
                                  ? Icons.bolt_outlined
                                  : Icons.terminal_outlined,
                              semanticLabel:
                                  suggestion.kind ==
                                      TaskPromptSuggestionKind.skill
                                  ? 'Skill'
                                  : 'Command',
                            ),
                            title: Text(suggestion.name),
                            subtitle: description == null || description.isEmpty
                                ? null
                                : Text(description),
                            trailing:
                                suggestion.kind ==
                                        TaskPromptSuggestionKind.command &&
                                    source != null &&
                                    source.isNotEmpty
                                ? Text(
                                    source,
                                    style: theme.textTheme.labelSmall,
                                  )
                                : null,
                            onTap: () => _selectSuggestion(suggestion),
                          );
                        },
                      ),
                    ),
                  ),
                ],
                const SizedBox(height: 16),
                OverflowBar(
                  alignment: MainAxisAlignment.end,
                  spacing: QuietPaperSpacing.related,
                  overflowSpacing: QuietPaperSpacing.compact,
                  children: <Widget>[
                    TextButton(
                      onPressed: _submitting
                          ? null
                          : () => Navigator.of(context).pop(),
                      child: const Text('Cancel'),
                    ),
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
