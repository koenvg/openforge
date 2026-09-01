export {
  createMockBackendOpenForgeApi,
  createMockFrontendOpenForgeApi,
  createMockOpenForgeApi,
  createMockPluginContext,
  createOpenForgeRegistryFake,
  TestingOpenForgeRegistryFake,
} from './testing/registryFake.js'
export {
  createMemoryPluginStorage,
  createTestingCalls,
  TestingSubscriptionSink,
} from './testing/support.js'

export type {
  MockBackendOpenForgeAPI,
  MockFrontendOpenForgeAPI,
  TestingBackgroundServiceContribution,
  TestingBackendMethodContribution,
  TestingCommandContribution,
  TestingContributionBase,
  TestingExternalTextFile,
  TestingExternalTextFileChunksCall,
  TestingTaskWorkspaceFixture,
  TestingEventListenerContribution,
  TestingInjectionPointContribution,
  TestingOpenForgeApiCalls,
  TestingOpenForgeApiOptions,
  TestingOpenForgeRegistrySnapshot,
  TestingRuntimeKind,
  TestingRuntimeScope,
  TestingSettingsSectionContribution,
  TestingTaskPaneTabContribution,
  TestingTaskUISectionContribution,
  TestingViewContribution,
  TestingViewReplacementContribution,
} from './testing/contracts.js'
