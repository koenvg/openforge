import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/client/pinned_companion_transport.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

typedef _Mutation = ({String path, Future<void> Function() run});

void main() {
  test(
    'every generated no-content mutation accepts an empty 204 body',
    () async {
      final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      final receivedPaths = <String>[];
      server.listen((request) async {
        receivedPaths.add(request.uri.path);
        request.response.statusCode = HttpStatus.noContent;
        await request.response.close();
      });

      final transport = PinnedCompanionTransport(
        certificateSha256: 'unused-for-http',
        client: HttpClient(),
      );
      final client = CompanionV1Client(
        baseUrl: Uri(
          scheme: 'http',
          host: InternetAddress.loopbackIPv4.address,
          port: server.port,
        ),
        transport: transport,
      );
      final mutations = <_Mutation>[
        (
          path: '/companion/v1/tasks/T-1/set-aside',
          run: () => client.setAsideCompanionTask(
            taskId: 'T-1',
            credential: 'credential-1',
          ),
        ),
        (
          path: '/companion/v1/tasks/T-1/return-to-board',
          run: () => client.returnCompanionTaskToBoard(
            taskId: 'T-1',
            credential: 'credential-1',
          ),
        ),
        (
          path: '/companion/v1/tasks/T-1/merge',
          run: () => client.mergeCompanionTaskPullRequest(
            taskId: 'T-1',
            mergeMethod: PullRequestMergeMethod.squash,
            credential: 'credential-1',
          ),
        ),
        (
          path: '/companion/v1/tasks/T-1/enqueue',
          run: () => client.enqueueCompanionTaskPullRequest(
            taskId: 'T-1',
            credential: 'credential-1',
          ),
        ),
        (
          path: '/companion/v1/tasks/T-1/run-app',
          run: () => client.runCompanionTaskApp(
            taskId: 'T-1',
            credential: 'credential-1',
          ),
        ),
        (
          path: '/companion/v1/refresh-github',
          run: () => client.refreshCompanionGithub(credential: 'credential-1'),
        ),
      ];

      try {
        expect(
          mutations.map((mutation) => mutation.path).toList()..sort(),
          _contractNoContentMutationPaths()
              .map((path) => path.replaceAll('{taskId}', 'T-1'))
              .toList(),
        );
        for (final mutation in mutations) {
          await mutation.run();
        }
      } finally {
        transport.close();
        await server.close(force: true);
      }

      expect(receivedPaths, mutations.map((mutation) => mutation.path));
    },
  );
}

List<String> _contractNoContentMutationPaths() {
  final contract =
      jsonDecode(
            File(
              '../../docs/contracts/companion-v1.openapi.json',
            ).readAsStringSync(),
          )
          as Map<String, Object?>;
  final paths = contract['paths']! as Map<String, Object?>;
  final noContentPaths = <String>[];
  for (final path in paths.entries) {
    for (final operation in (path.value! as Map<String, Object?>).values) {
      final responses = (operation! as Map<String, Object?>)['responses']!;
      if ((responses as Map<String, Object?>).containsKey('204')) {
        noContentPaths.add('/companion/v1${path.key}');
      }
    }
  }
  return noContentPaths..sort();
}
