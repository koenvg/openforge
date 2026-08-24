#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_CONTRACT = 'docs/contracts/companion-v1.openapi.json'
const DEFAULT_OUTPUT = 'apps/mobile_companion/lib/src/generated/companion_v1_client.dart'
const HTTP_METHODS = new Set(['delete', 'get', 'patch', 'post', 'put'])
const INLINE_ENUM_PROPERTIES = new Map([
  ['TaskStartResult.outcome', 'TaskStartOutcome'],
])
const TASK_DETAIL_EMPTY_LIST_DEFAULTS = new Set([
  'labels',
  'dependencies',
  'dependentTasks',
])

const lowerCamel = (value) => {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (words.length === 0) return 'value'
  return words
    .map((word, index) => {
      const normalizedWord =
        word.length > 1 && word === word.toUpperCase() ? word.toLowerCase() : word
      const normalized = normalizedWord[0].toUpperCase() + normalizedWord.slice(1)
      return index === 0 ? normalized[0].toLowerCase() + normalized.slice(1) : normalized
    })
    .join('')
}

const upperCamel = (value) => {
  const name = lowerCamel(value)
  return name[0].toUpperCase() + name.slice(1)
}

const dartString = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'").replaceAll('$', '\\$')}'`
const dartInterpolatedString = (value) => `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
const refName = (ref) => ref.split('/').at(-1)
const isNullable = (schema) => Array.isArray(schema?.type) && schema.type.includes('null')
const schemaType = (schema) => {
  const declared = Array.isArray(schema?.type)
    ? schema.type.find((type) => type !== 'null')
    : schema?.type
  if (declared || schema?.const === undefined) return declared
  if (Number.isInteger(schema.const)) return 'integer'
  return typeof schema.const
}

function resolveLocalRef(contract, value) {
  if (!value?.$ref) return value
  return value.$ref
    .slice(2)
    .split('/')
    .reduce((current, part) => current[part], contract)
}

function enumCase(value) {
  const name = lowerCamel(String(value))
  return new Set(['class', 'enum', 'extension', 'final', 'switch']).has(name) ? `${name}Value` : name
}

function inlineEnumName(context) {
  return INLINE_ENUM_PROPERTIES.get(`${context.owner}.${context.property}`)
}

function dartType(schema, context, { optional = false } = {}) {
  let type
  const inlineEnum = inlineEnumName(context)
  if (inlineEnum) {
    type = inlineEnum
  } else if (schema.$ref) {
    type = refName(schema.$ref)
  } else if (schema.oneOf && context.owner === 'ResourceInvalidationData') {
    type = 'CompanionResourceIdentityData'
  } else {
    switch (schemaType(schema)) {
      case 'array':
        type = `List<${dartType(schema.items, { ...context, property: `${context.property}Item` })}>`
        break
      case 'boolean':
        type = 'bool'
        break
      case 'integer':
        type = 'int'
        break
      case 'number':
        type = 'double'
        break
      case 'object':
        type = `${context.owner}${upperCamel(context.property)}`
        break
      case 'string':
      default:
        type = schema.format === 'date-time' ? 'DateTime' : 'String'
        break
    }
  }
  return optional || isNullable(schema) ? `${type}?` : type
}

function renderEnum(name, schema) {
  const values = schema.enum ?? (schema.const === undefined ? [] : [schema.const])
  return `enum ${name} {
${values.map((value) => `  ${enumCase(value)}(${dartString(value)}),`).join('\n')}
  ;

  const ${name}(this.wireValue);

  final String wireValue;

  static ${name} fromWire(String value) =>
      tryFromWire(value) ??
      (throw FormatException('Invalid ${name} value: \$value.'));

  static ${name}? tryFromWire(String value) {
    for (final candidate in values) {
      if (candidate.wireValue == value) return candidate;
    }
    return null;
  }
}
`
}

function decoderFor(schema, context, valueExpression) {
  const key = dartString(context.property)
  const inlineEnum = inlineEnumName(context)
  if (inlineEnum) {
    return `${inlineEnum}.fromWire(_asString(${valueExpression}, ${key}))`
  }
  if (schema.$ref) {
    const name = refName(schema.$ref)
    const target = context.schemas[name]
    if (target?.enum) return `${name}.fromWire(_asString(${valueExpression}, ${key}))`
    return `${name}.fromJson(_asObject(${valueExpression}, ${key}))`
  }
  if (schema.oneOf && context.owner === 'ResourceInvalidationData') {
    return `CompanionResourceIdentityData.fromJson(_asObject(${valueExpression}, ${key}))`
  }

  switch (schemaType(schema)) {
    case 'array': {
      const item = decoderFor(schema.items, { ...context, property: `${context.property}Item` }, 'item')
      const minimum = schema.minItems === undefined ? '' : `, minItems: ${schema.minItems}`
      return `_asList(${valueExpression}, ${key}${minimum}).map((item) => ${item}).toList()`
    }
    case 'boolean':
      return `_asBool(${valueExpression}, ${key}${schema.const === undefined ? '' : `, constant: ${schema.const}`})`
    case 'integer':
      return `_asInt(${valueExpression}, ${key}${schema.minimum === undefined ? '' : `, minimum: ${schema.minimum}`}${schema.const === undefined ? '' : `, constant: ${schema.const}`})`
    case 'number':
      return `_asDouble(${valueExpression}, ${key})`
    case 'object': {
      const name = `${context.owner}${upperCamel(context.property)}`
      return `${name}.fromJson(_asObject(${valueExpression}, ${key}))`
    }
    case 'string':
    default: {
      if (schema.format === 'date-time') return `_asDateTime(${valueExpression}, ${key})`
      const options = []
      if (schema.minLength !== undefined) options.push(`minLength: ${schema.minLength}`)
      if (schema.maxLength !== undefined) options.push(`maxLength: ${schema.maxLength}`)
      if (schema.pattern !== undefined) options.push(`pattern: ${dartString(schema.pattern)}`)
      if (schema.const !== undefined) options.push(`constant: ${dartString(schema.const)}`)
      if (schema.enum) options.push(`allowed: const <String>{${schema.enum.map(dartString).join(', ')}}`)
      return `_asString(${valueExpression}, ${key}${options.length ? `, ${options.join(', ')}` : ''})`
    }
  }
}

function fieldDecoder(name, property, schema, required, schemas) {
  const context = { owner: name, property, schemas }
  const decoder = decoderFor(schema, context, 'value')
  if (required && isNullable(schema)) {
    return `_requiredNullable(json, ${dartString(property)}, (value) => ${decoder})`
  }
  if (required) return `_required(json, ${dartString(property)}, (value) => ${decoder})`
  return `_optional(json, ${dartString(property)}, (value) => ${decoder})`
}

function encoderFor(schema, expression, context) {
  if (inlineEnumName(context)) return `${expression}.wireValue`
  if (schema.$ref) {
    const target = context.schemas[refName(schema.$ref)]
    return target?.enum ? `${expression}.wireValue` : `${expression}.toJson()`
  }
  if (schema.oneOf && context.owner === 'ResourceInvalidationData') return `${expression}.toJson()`
  if (schemaType(schema) === 'array') {
    const encoded = encoderFor(schema.items, 'item', { ...context, property: `${context.property}Item` })
    return `${expression}.map((item) => ${encoded}).toList()`
  }
  if (schemaType(schema) === 'object') return `${expression}.toJson()`
  if (schema.format === 'date-time') return `${expression}.toUtc().toIso8601String()`
  return expression
}

function specialValidation(name) {
  switch (name) {
    case 'PairingPoll':
      return `
    final validPending =
        model.status == 'pending' &&
        model.deviceId == null &&
        model.credential == null;
    final validApproved =
        model.status == 'approved' &&
        model.deviceId != null &&
        model.credential != null;
    if (!validPending && !validApproved) {
      throw const FormatException('Invalid pairing decision.');
    }
`
    case 'ProjectBoardLanes':
      return `
    _expectBoardLane(model.focus, ProjectBoardLane.focus);
    _expectBoardLane(model.inFlight, ProjectBoardLane.inFlight);
    _expectBoardLane(model.outOfFocus, ProjectBoardLane.outOfFocus);
    _expectBoardLane(model.backlog, ProjectBoardLane.backlog);
`
    case 'ProjectBoard':
      return `
    if (model.counts.focus != model.lanes.focus.length ||
        model.counts.inFlight != model.lanes.inFlight.length ||
        model.counts.outOfFocus != model.lanes.outOfFocus.length ||
        model.counts.backlog != model.lanes.backlog.length) {
      throw const FormatException(
        'Project Board counts do not match lane membership.',
      );
    }
`
    default:
      return ''
  }
}

function renderInlineObject(name, schema, schemas) {
  return renderObject(name, schema, schemas)
}

function renderObject(name, schema, schemas) {
  const properties = Object.entries(schema.properties ?? {})
  const required = new Set(schema.required ?? [])
  const listProperties = properties.filter(([, propertySchema]) => schemaType(propertySchema) === 'array')
  const canBeConst = listProperties.length === 0
  const constructorArguments = properties.map(([property, propertySchema]) => {
    if (name === 'TaskDetail' && property === 'agentTerminalAvailable') {
      return '    this.agentTerminalAvailable = false,'
    }
    if (schemaType(propertySchema) === 'array') {
      const field = lowerCamel(property)
      const itemType = dartType(propertySchema.items, {
        owner: name,
        property: `${property}Item`,
      })
      const defaultsToEmpty =
        name === 'TaskDetail' && TASK_DETAIL_EMPTY_LIST_DEFAULTS.has(property)
      return defaultsToEmpty
        ? `    List<${itemType}> ${field} = const <${itemType}>[],`
        : `    required List<${itemType}> ${field},`
    }
    return `    required this.${lowerCamel(property)},`
  })
  const initializers = listProperties.map(([property, propertySchema]) => {
    const field = lowerCamel(property)
    const itemType = dartType(propertySchema.items, { owner: name, property: `${property}Item` })
    return `${field} = List<${itemType}>.unmodifiable(${field})`
  })
  const constructor = initializers.length
    ? `  ${name}({\n${constructorArguments.join('\n')}\n  }) : ${initializers.join(',\n       ')};`
    : `  ${canBeConst ? 'const ' : ''}${name}({\n${constructorArguments.join('\n')}\n  });`

  const allowed = properties.map(([property]) => dartString(property)).join(', ')
  const assignments = properties.map(([property, propertySchema]) => {
    return `      ${lowerCamel(property)}: ${fieldDecoder(name, property, propertySchema, required.has(property), schemas)},`
  })
  const fields = properties.map(([property, propertySchema]) => {
    const type = dartType(propertySchema, { owner: name, property }, { optional: !required.has(property) })
    return `  final ${type} ${lowerCamel(property)};`
  })
  const encodings = properties.map(([property, propertySchema]) => {
    const field = lowerCamel(property)
    const type = dartType(propertySchema, { owner: name, property }, { optional: !required.has(property) })
    const nullable = type.endsWith('?')
    const encoded = encoderFor(propertySchema, nullable ? `${field}!` : field, { owner: name, property, schemas })
    if (!required.has(property)) return `      if (${field} != null) ${dartString(property)}: ${encoded},`
    if (nullable) return `      ${dartString(property)}: ${field} == null ? null : ${encoded},`
    return `      ${dartString(property)}: ${encoded},`
  })

  return `final class ${name} {
${constructor}

  factory ${name}.fromJson(Map<String, Object?> json) {
    _expectOnly(json, const <String>{${allowed}});
    final model = ${name}(
${assignments.join('\n')}
    );
${specialValidation(name)}    return model;
  }

  Map<String, Object?> toJson() => <String, Object?>{
${encodings.join('\n')}
  };

${fields.join('\n')}
}
`
}

function renderResourceIdentity(schema) {
  const variants = schema.properties.resources.items.oneOf
  const cases = variants.map((variant) => {
    const kind = variant.properties.kind.const
    const className = `${upperCamel(kind)}ResourceIdentityData`
    const hasId = Boolean(variant.properties.id)
    return `      case ${dartString(kind)}:
        _expectOnly(json, const <String>{${hasId ? "'kind', 'id'" : "'kind'"}});
        return ${hasId ? `${className}(_required(json, 'id', (value) => _asString(value, 'id', minLength: ${variant.properties.id.minLength ?? 0})))` : `const ${className}()`};`
  })
  const classes = variants.map((variant) => {
    const kind = variant.properties.kind.const
    const className = `${upperCamel(kind)}ResourceIdentityData`
    const hasId = Boolean(variant.properties.id)
    return `final class ${className} extends CompanionResourceIdentityData {
  const ${className}(${hasId ? 'this.id' : ''});
${hasId ? '\n  final String id;\n' : ''}
  @override
  Map<String, Object?> toJson() => <String, Object?>{
    'kind': ${dartString(kind)},${hasId ? "\n    'id': id," : ''}
  };
}
`
  })
  return `sealed class CompanionResourceIdentityData {
  const CompanionResourceIdentityData();

  factory CompanionResourceIdentityData.fromJson(Map<String, Object?> json) {
    switch (_required(json, 'kind', (value) => _asString(value, 'kind'))) {
${cases.join('\n')}
      default:
        throw const FormatException('Invalid Companion resource kind.');
    }
  }

  Map<String, Object?> toJson();
}

${classes.join('\n')}`
}

function collectInlineModels(schemas) {
  const inline = []
  for (const [owner, schema] of Object.entries(schemas)) {
    for (const [property, propertySchema] of Object.entries(schema.properties ?? {})) {
      if (schemaType(propertySchema) === 'object' && !propertySchema.$ref) {
        inline.push([`${owner}${upperCamel(property)}`, propertySchema])
      }
    }
  }
  return inline
}

function operationEntries(contract) {
  const entries = []
  for (const [path, pathItem] of Object.entries(contract.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (HTTP_METHODS.has(method) && operation.operationId) entries.push({ path, method, operation })
    }
  }
  return entries
}

function successResponse(operation) {
  const successes = Object.entries(operation.responses ?? {}).filter(([status]) => /^2\d\d$/.test(status))
  const response = successes.map(([, value]) => value).find((value) => !value.$ref)
  const content = response?.content ?? {}
  const mediaType = Object.keys(content)[0]
  return {
    statuses: successes.map(([status]) => Number(status)).sort((left, right) => left - right),
    mediaType,
    schema: mediaType ? content[mediaType].schema : null,
  }
}

function operationParameters(contract, operation, path) {
  const parameters = (operation.parameters ?? []).map((parameter) => resolveLocalRef(contract, parameter))
  const result = []
  for (const parameter of parameters.filter((parameter) => parameter.in === 'path')) {
    result.push({ name: lowerCamel(parameter.name), type: dartType(parameter.schema, { owner: 'Operation', property: parameter.name }), required: true })
  }

  const requestSchema = operation.requestBody?.content?.['application/json']?.schema
  if (requestSchema?.$ref) {
    const modelName = refName(requestSchema.$ref)
    const model = contract.components.schemas[modelName]
    for (const [property, schema] of Object.entries(model.properties ?? {})) {
      result.push({ name: lowerCamel(property), type: dartType(schema, { owner: modelName, property }), required: (model.required ?? []).includes(property), bodyModel: modelName, bodyProperty: property })
    }
  }

  const authorization = parameters.find((parameter) => parameter.in === 'header' && parameter.name.toLowerCase() === 'authorization')
  if (authorization) result.push({ name: 'secret', type: 'String', required: true, header: authorization })
  if ((operation.security ?? []).length > 0) result.push({ name: 'credential', type: 'String', required: true, bearer: true })

  for (const parameter of parameters.filter((parameter) => parameter.in === 'header')) {
    if (parameter === authorization || parameter.name === contract.components.parameters?.CompanionProtocolVersion?.name) continue
    result.push({
      name: lowerCamel(parameter.name),
      type: dartType(parameter.schema, { owner: 'Operation', property: parameter.name }, { optional: !parameter.required }),
      required: Boolean(parameter.required),
      header: parameter,
    })
  }

  for (const match of path.matchAll(/{([^}]+)}/g)) {
    if (!result.some((parameter) => parameter.name === lowerCamel(match[1]))) {
      throw new Error(`Operation ${operation.operationId} is missing path parameter ${match[1]}.`)
    }
  }
  return result
}

function renderResolvedPath(serverUrl, path) {
  const fullPath = `${serverUrl}${path}`.replaceAll(/\/+/g, '/')
  return fullPath.replace(/{([^}]+)}/g, (_, name) => `\${Uri.encodeComponent(${lowerCamel(name)})}`)
}

function renderOperation(contract, entry, protocol) {
  const { method, operation, path } = entry
  const response = successResponse(operation)
  const parameters = operationParameters(contract, operation, path)
  const isStream = response.mediaType === 'text/event-stream'
  const returnType = isStream ? 'CompanionV1StreamRequest' : response.schema?.$ref ? refName(response.schema.$ref) : 'void'
  const signature = parameters
    .map((parameter) => `    ${parameter.required ? 'required ' : ''}${parameter.type} ${parameter.name},`)
    .join('\n')
  const serverUrl = contract.servers?.[0]?.url ?? ''
  const resolvedPath = renderResolvedPath(serverUrl, path)
  const headerLines = []
  if (isStream) headerLines.push("      'accept': 'text/event-stream',")
  const requestSchema = operation.requestBody?.content?.['application/json']?.schema
  if (requestSchema) headerLines.push("      'content-type': 'application/json',")
  for (const parameter of parameters) {
    if (parameter.bearer) headerLines.push(`      'authorization': 'Bearer \$${parameter.name}',`)
    if (parameter.header) {
      const headerName = parameter.header.name.toLowerCase()
      const prefix = parameter.header.schema?.pattern?.match(/^\^([A-Za-z]+ )/)?.[1]
      const value = prefix ? `${prefix}\$${parameter.name}` : `\$${parameter.name}`
      headerLines.push(
        `      ${dartString(headerName)}: ${parameter.required ? dartInterpolatedString(value) : `?${parameter.name}`},`,
      )
    }
  }
  const operationParametersResolved = (operation.parameters ?? []).map((parameter) => resolveLocalRef(contract, parameter))
  if (operationParametersResolved.some((parameter) => parameter.name === protocol.name)) {
    headerLines.push('      companionV1ProtocolVersionHeader: companionV1ProtocolVersion,')
  }

  if (isStream) {
    return `  CompanionV1StreamRequest ${operation.operationId}({
${signature}
  }) => CompanionV1StreamRequest(
    method: ${dartString(method.toUpperCase())},
    uri: baseUrl.resolve(${dartInterpolatedString(resolvedPath)}),
    headers: <String, String>{
${headerLines.join('\n')}
    },
  );`
  }

  let body = ''
  if (requestSchema?.$ref) {
    const modelName = refName(requestSchema.$ref)
    const bodyParameters = parameters.filter((parameter) => parameter.bodyModel === modelName)
    body = `
      body: jsonEncode(
        ${modelName}(
${bodyParameters.map((parameter) => `          ${lowerCamel(parameter.bodyProperty)}: ${parameter.name},`).join('\n')}
        ).toJson(),
      ),`
  }
  const statuses = response.statuses.join(', ')
  const decode = returnType === 'void'
    ? `    _expectSuccessWithoutBody(response, const <int>{${statuses}});`
    : `    return ${returnType}.fromJson(
      _successJson(response, const <int>{${statuses}}),
    );`
  return `  Future<${returnType}> ${operation.operationId}({
${signature}
  }) async {
    final response = await transport.send(
      method: ${dartString(method.toUpperCase())},
      uri: baseUrl.resolve(${dartInterpolatedString(resolvedPath)}),
      headers: <String, String>{
${headerLines.join('\n')}
      },${body}
    );
${decode}
  }`
}

function renderSupport(errorCodeName) {
  return `void _expectSuccessWithoutBody(
  CompanionV1HttpResponse response,
  Set<int> expectedStatuses,
) {
  if (expectedStatuses.contains(response.statusCode)) return;
  _successJson(response, expectedStatuses);
}

Map<String, Object?> _successJson(
  CompanionV1HttpResponse response,
  Set<int> expectedStatuses,
) {
  final decoded = jsonDecode(response.body);
  if (!expectedStatuses.contains(response.statusCode)) {
    if (decoded is Map<String, Object?> &&
        decoded.keys.length == 1 &&
        decoded['error'] is Map<String, Object?>) {
      final error = decoded['error']! as Map<String, Object?>;
      final code = error['code'];
      final message = error['message'];
      final requestId = error['requestId'];
      final validRequestId =
          error.containsKey('requestId') &&
          (requestId == null || requestId is String);
      if (error.keys.length == 3 &&
          code is String &&
          ${errorCodeName}.tryFromWire(code) != null &&
          message is String &&
          validRequestId) {
        throw CompanionV1Exception(
          statusCode: response.statusCode,
          code: code,
          message: message,
        );
      }
    }
    throw CompanionV1Exception(
      statusCode: response.statusCode,
      code: 'temporarily_unavailable',
      message: 'The desktop returned an invalid error response.',
    );
  }
  if (decoded is! Map<String, Object?>) {
    throw const FormatException('Expected a Companion response object.');
  }
  return decoded;
}

void _expectOnly(Map<String, Object?> json, Set<String> allowed) {
  if (json.keys.any((key) => !allowed.contains(key))) {
    throw const FormatException('Companion response contains unknown fields.');
  }
}

T _required<T>(
  Map<String, Object?> json,
  String key,
  T Function(Object? value) decode,
) {
  if (!json.containsKey(key)) throw FormatException('Missing required field \$key.');
  return decode(json[key]);
}

T? _requiredNullable<T>(
  Map<String, Object?> json,
  String key,
  T Function(Object? value) decode,
) {
  if (!json.containsKey(key)) throw FormatException('Missing required field \$key.');
  final value = json[key];
  return value == null ? null : decode(value);
}

T? _optional<T>(
  Map<String, Object?> json,
  String key,
  T Function(Object? value) decode,
) {
  if (!json.containsKey(key)) return null;
  return decode(json[key]);
}

Map<String, Object?> _asObject(Object? value, String key) {
  if (value is! Map<String, Object?>) {
    throw FormatException('Expected object field \$key.');
  }
  return value;
}

List<Object?> _asList(Object? value, String key, {int? minItems}) {
  if (value is! List<Object?> || (minItems != null && value.length < minItems)) {
    throw FormatException('Expected list field \$key.');
  }
  return value;
}

String _asString(
  Object? value,
  String key, {
  int? minLength,
  int? maxLength,
  String? pattern,
  String? constant,
  Set<String>? allowed,
}) {
  if (value is! String ||
      (minLength != null && value.length < minLength) ||
      (maxLength != null && value.length > maxLength) ||
      (pattern != null && !RegExp(pattern).hasMatch(value)) ||
      (constant != null && value != constant) ||
      (allowed != null && !allowed.contains(value))) {
    throw FormatException('Expected valid string field \$key.');
  }
  return value;
}

int _asInt(Object? value, String key, {int? minimum, int? constant}) {
  if (value is! int ||
      (minimum != null && value < minimum) ||
      (constant != null && value != constant)) {
    throw FormatException('Expected valid integer field \$key.');
  }
  return value;
}

// ignore: unused_element
double _asDouble(Object? value, String key) {
  if (value is! num) throw FormatException('Expected number field \$key.');
  return value.toDouble();
}

bool _asBool(Object? value, String key, {bool? constant}) {
  if (value is! bool || (constant != null && value != constant)) {
    throw FormatException('Expected boolean field \$key.');
  }
  return value;
}

DateTime _asDateTime(Object? value, String key) {
  final text = _asString(value, key);
  if (!RegExp(
    r'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})\$',
  ).hasMatch(text)) {
    throw FormatException('Expected RFC 3339 field \$key.');
  }
  return DateTime.parse(text);
}

void _expectBoardLane(
  List<ProjectBoardTask> tasks,
  ProjectBoardLane expectedLane,
) {
  if (tasks.any((task) => task.lane != expectedLane)) {
    throw const FormatException('Project Board Task is in the wrong lane.');
  }
}
`
}

export function generateCompanionDartClient(contractSource) {
  const contract = JSON.parse(contractSource)
  const schemas = contract.components?.schemas
  if (!schemas || !contract.paths) throw new Error('Companion OpenAPI contract is missing schemas or paths.')
  const fingerprint = createHash('sha256').update(contractSource).digest('hex')
  const protocol = resolveLocalRef(contract, contract.components.parameters.CompanionProtocolVersion)
  const protocolValue = String(protocol.schema.const)
  const enums = Object.entries(schemas).filter(([, schema]) => schema.type === 'string' && Array.isArray(schema.enum))
  const objects = Object.entries(schemas).filter(([, schema]) => schema.type === 'object')
  const inlineModels = collectInlineModels(schemas)
  const resourceSchema = schemas.ResourceInvalidationData
  const modelSections = []
  for (const [name, schema] of enums) modelSections.push(renderEnum(name, schema))
  for (const [propertyPath, name] of INLINE_ENUM_PROPERTIES) {
    const [owner, property] = propertyPath.split('.')
    const schema = schemas[owner]?.properties?.[property]
    if (schema) modelSections.push(renderEnum(name, schema))
  }
  if (resourceSchema?.properties?.resources?.items?.oneOf) {
    modelSections.push(renderResourceIdentity(resourceSchema))
  }
  for (const [name, schema] of inlineModels) modelSections.push(renderInlineObject(name, schema, schemas))
  for (const [name, schema] of objects) modelSections.push(renderObject(name, schema, schemas))
  const operations = operationEntries(contract).map((entry) => renderOperation(contract, entry, protocol)).join('\n\n')

  return `// GENERATED CODE - DO NOT MODIFY BY HAND.
// Generated by scripts/generate-companion-dart-client.mjs.
// Source: ${DEFAULT_CONTRACT} (OpenAPI ${contract.openapi}, v${contract.info.version}).
// ignore_for_file: prefer_null_aware_operators, use_null_aware_elements

import 'dart:convert';

const companionV1OpenApiSha256 =
    '${fingerprint}';
const companionV1ProtocolVersionHeader = ${dartString(protocol.name)};
const companionV1ProtocolVersion = ${dartString(protocolValue)};

abstract interface class CompanionV1Transport {
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  });
}

final class CompanionV1HttpResponse {
  const CompanionV1HttpResponse({required this.statusCode, required this.body});

  final int statusCode;
  final String body;
}

final class CompanionV1StreamRequest {
  CompanionV1StreamRequest({
    required this.method,
    required this.uri,
    required Map<String, String> headers,
  }) : headers = Map<String, String>.unmodifiable(headers);

  final String method;
  final Uri uri;
  final Map<String, String> headers;
}

final class CompanionV1Exception implements Exception {
  const CompanionV1Exception({
    required this.statusCode,
    required this.code,
    required this.message,
  });

  final int statusCode;
  final String code;
  final String message;

  @override
  String toString() => 'CompanionV1Exception(\$statusCode, \$code)';
}

${modelSections.join('\n')}
final class CompanionV1Client {
  const CompanionV1Client({required this.baseUrl, required this.transport});

  final Uri baseUrl;
  final CompanionV1Transport transport;

${operations}
}

${renderSupport('ErrorCode')}`
}

export async function writeCompanionDartClient({ root = resolve(import.meta.dirname, '..') } = {}) {
  const contractPath = resolve(root, DEFAULT_CONTRACT)
  const outputPath = resolve(root, DEFAULT_OUTPUT)
  const contractSource = await readFile(contractPath, 'utf8')
  const generated = generateCompanionDartClient(contractSource)
  await writeFile(outputPath, generated)
  return outputPath
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const outputPath = await writeCompanionDartClient()
  console.log(`Generated ${outputPath}`)
}
