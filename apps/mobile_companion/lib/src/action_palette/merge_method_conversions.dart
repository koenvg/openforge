import '../generated/companion_v1_client.dart' as generated;
import 'action_palette_models.dart';

extension GeneratedPullRequestMergeMethodConversion
    on generated.PullRequestMergeMethod {
  MobileMergeMethod toMobileMergeMethod() => switch (this) {
    generated.PullRequestMergeMethod.merge => MobileMergeMethod.merge,
    generated.PullRequestMergeMethod.squash => MobileMergeMethod.squash,
    generated.PullRequestMergeMethod.rebase => MobileMergeMethod.rebase,
  };
}

extension MobileMergeMethodConversion on MobileMergeMethod {
  generated.PullRequestMergeMethod toGeneratedMergeMethod() => switch (this) {
    MobileMergeMethod.merge => generated.PullRequestMergeMethod.merge,
    MobileMergeMethod.squash => generated.PullRequestMergeMethod.squash,
    MobileMergeMethod.rebase => generated.PullRequestMergeMethod.rebase,
  };
}
