import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

final class RecordingCompanionTransport implements CompanionV1Transport {
  final List<
    ({String method, Uri uri, Map<String, String> headers, String? body})
  >
  requests = [];
  var responses = <CompanionV1HttpResponse>[];

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    requests.add((method: method, uri: uri, headers: headers, body: body));
    return responses.removeAt(0);
  }
}

final class EndpointCompanionTransport
    implements CloseableCompanionV1Transport {
  EndpointCompanionTransport(this.outcomes, {this.requests});

  final Map<String, Object> outcomes;
  final List<({Uri uri, Map<String, String> headers})>? requests;

  @override
  Future<CompanionV1HttpResponse> send({
    required String method,
    required Uri uri,
    required Map<String, String> headers,
    String? body,
  }) async {
    requests?.add((uri: uri, headers: headers));
    Object? outcome = outcomes[uri.host];
    if (outcome is List<Object>) outcome = outcome.removeAt(0);
    if (outcome is Exception) throw outcome;
    if (outcome is Future<CompanionV1HttpResponse>) return await outcome;
    return outcome! as CompanionV1HttpResponse;
  }

  @override
  void close() {}
}
