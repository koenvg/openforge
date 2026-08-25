import 'package:flutter_test/flutter_test.dart';
import 'package:openforge_companion/src/action_palette/action_palette.dart';
import 'package:openforge_companion/src/generated/companion_v1_client.dart';

void main() {
  test(
    'converts generated and mobile merge methods at one shared boundary',
    () {
      expect(
        PullRequestMergeMethod.merge.toMobileMergeMethod(),
        MobileMergeMethod.merge,
      );
      expect(
        PullRequestMergeMethod.squash.toMobileMergeMethod(),
        MobileMergeMethod.squash,
      );
      expect(
        PullRequestMergeMethod.rebase.toMobileMergeMethod(),
        MobileMergeMethod.rebase,
      );
      expect(
        MobileMergeMethod.merge.toGeneratedMergeMethod(),
        PullRequestMergeMethod.merge,
      );
      expect(
        MobileMergeMethod.squash.toGeneratedMergeMethod(),
        PullRequestMergeMethod.squash,
      );
      expect(
        MobileMergeMethod.rebase.toGeneratedMergeMethod(),
        PullRequestMergeMethod.rebase,
      );
    },
  );
}
