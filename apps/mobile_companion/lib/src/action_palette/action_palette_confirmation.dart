import 'action_palette_models.dart';

String mobileActionPaletteConfirmationMessage(
  MobilePaletteAction action, {
  String? taskTitle,
  bool inlineTaskQuestion = false,
  bool agentRunning = false,
}) => switch (action.id) {
  CompanionActionId.deleteTask =>
    '${_taskQuestion(action, taskTitle, inlineTaskQuestion)}This permanently deletes the Task and removes any runtime workspace state. The Task will not remain available as reference data. This cannot be undone.',
  CompanionActionId.completeTask =>
    '${_taskQuestion(action, taskTitle, inlineTaskQuestion)}This keeps the Completed Task as reference data while its runtime workspace is removed.'
        '${agentRunning ? ' The running Agent and all Task shells will stop first.' : ''}',
  _ => action.label,
};

String _taskQuestion(
  MobilePaletteAction action,
  String? taskTitle,
  bool inline,
) {
  if (!inline) return '';
  final subject = taskTitle == null ? '' : ' “$taskTitle”';
  return '${action.label}$subject? ';
}
