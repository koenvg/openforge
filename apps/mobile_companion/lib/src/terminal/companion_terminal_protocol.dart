import 'dart:convert';

final class TerminalDimensions {
  const TerminalDimensions({required this.columns, required this.rows})
    : assert(columns > 0),
      assert(rows > 0);

  final int columns;
  final int rows;
}

sealed class ClientTerminalControl {
  const ClientTerminalControl();

  factory ClientTerminalControl.decode(String encoded) {
    final json = _controlObject(encoded);
    return switch (json['type']) {
      'attach' => AttachTerminalControl(_dimensions(json, 'attach')),
      'resize' => ResizeTerminalControl(_dimensions(json, 'resize')),
      _ => throw const FormatException('Invalid client terminal control.'),
    };
  }

  String encode();
}

final class AttachTerminalControl extends ClientTerminalControl {
  const AttachTerminalControl(this.dimensions);

  final TerminalDimensions dimensions;

  @override
  String encode() => jsonEncode(<String, Object>{
    'type': 'attach',
    'columns': dimensions.columns,
    'rows': dimensions.rows,
  });
}

final class ResizeTerminalControl extends ClientTerminalControl {
  const ResizeTerminalControl(this.dimensions);

  final TerminalDimensions dimensions;

  @override
  String encode() => jsonEncode(<String, Object>{
    'type': 'resize',
    'columns': dimensions.columns,
    'rows': dimensions.rows,
  });
}

sealed class ServerTerminalControl {
  const ServerTerminalControl();

  factory ServerTerminalControl.decode(String encoded) {
    final json = _controlObject(encoded);
    return switch (json['type']) {
      'ready' => _ready(json),
      'exited' => _unit(json, const ExitedTerminalControl()),
      'error' => _error(json),
      'authorization_revoked' => _unit(
        json,
        const AuthorizationRevokedTerminalControl(),
      ),
      'gateway_closing' => _unit(json, const GatewayClosingTerminalControl()),
      _ => throw const FormatException('Invalid server terminal control.'),
    };
  }
}

final class ReadyTerminalControl extends ServerTerminalControl {
  const ReadyTerminalControl();
}

final class ExitedTerminalControl extends ServerTerminalControl {
  const ExitedTerminalControl();
}

final class ErrorTerminalControl extends ServerTerminalControl {
  const ErrorTerminalControl({required this.code, required this.message});

  final String code;
  final String message;
}

final class AuthorizationRevokedTerminalControl extends ServerTerminalControl {
  const AuthorizationRevokedTerminalControl();
}

final class GatewayClosingTerminalControl extends ServerTerminalControl {
  const GatewayClosingTerminalControl();
}

Map<String, Object?> _controlObject(String encoded) {
  final value = jsonDecode(encoded);
  if (value is! Map<String, Object?>) {
    throw const FormatException('Terminal control must be an object.');
  }
  return value;
}

TerminalDimensions _dimensions(Map<String, Object?> json, String type) {
  _expectFields(json, const <String>{'type', 'columns', 'rows'});
  if (json['type'] != type || json['columns'] is! int || json['rows'] is! int) {
    throw const FormatException('Invalid terminal dimensions.');
  }
  final columns = json['columns']! as int;
  final rows = json['rows']! as int;
  if (columns <= 0 || rows <= 0 || columns > 65535 || rows > 65535) {
    throw const FormatException('Invalid terminal dimensions.');
  }
  return TerminalDimensions(columns: columns, rows: rows);
}

ServerTerminalControl _ready(Map<String, Object?> json) {
  _expectFields(json, const <String>{'type', 'initialState'});
  if (json['initialState'] != 'replay') {
    throw const FormatException('Invalid terminal initial state.');
  }
  return const ReadyTerminalControl();
}

ServerTerminalControl _unit(
  Map<String, Object?> json,
  ServerTerminalControl control,
) {
  _expectFields(json, const <String>{'type'});
  return control;
}

ServerTerminalControl _error(Map<String, Object?> json) {
  _expectFields(json, const <String>{'type', 'code', 'message'});
  const safeCodes = <String>{
    'no_active_agent_terminal',
    'attachment_replaced',
    'protocol_error',
    'slow_consumer',
    'temporarily_unavailable',
  };
  final code = json['code'];
  final message = json['message'];
  if (code is! String ||
      !safeCodes.contains(code) ||
      message is! String ||
      message.isEmpty) {
    throw const FormatException('Invalid terminal error.');
  }
  return ErrorTerminalControl(code: code, message: message);
}

void _expectFields(Map<String, Object?> json, Set<String> fields) {
  if (json.length != fields.length || !json.keys.toSet().containsAll(fields)) {
    throw const FormatException('Terminal control has unexpected fields.');
  }
}
