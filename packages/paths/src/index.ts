// Anvil path resolution utilities
export {
  expandTilde,
  isDocker,
  getAnvilHome,
  getAnvilWorkspacesPath,
  ensureAnvilWorkspacesPath,
  getAnvilWorktreesPath,
  getAnvilConfigPath,
  getCredentialKeyPath,
  getWorkflowIntakesPath,
  getAnvilEnvPath,
  getRepoAnvilEnvPath,
  getHomeWorkflowsPath,
  getHomeCommandsPath,
  getHomeScriptsPath,
  getLegacyHomeWorkflowsPath,
  getCommandFolderSearchPaths,
  getWorkflowFolderSearchPaths,
  getAppAnvilBasePath,
  getDefaultCommandsPath,
  getDefaultWorkflowsPath,
  logAnvilPaths,
  validateAppDefaultsPaths,
  parseOwnerRepo,
  getProjectRoot,
  getProjectSourcePath,
  getProjectWorktreesPath,
  getProjectArtifactsPath,
  getProjectLogsPath,
  getRunArtifactsPath,
  getRunLogPath,
  resolveProjectRootFromCwd,
  resolveRegisteredProjectRoot,
  ensureProjectStructure,
  createProjectSourceSymlink,
  findMarkdownFilesRecursive,
  getWebDistDir,
} from './anvil-paths';

// Env loader
export { loadAnvilEnv, isVerboseBoot } from './env-loader';

// Logger
export { createLogger, setLogLevel, getLogLevel, rootLogger } from './logger';
export type { Logger } from './logger';

// Build-time constants (rewritten by scripts/build-binaries.sh)
export { BUNDLED_IS_BINARY, BUNDLED_VERSION, BUNDLED_GIT_COMMIT } from './bundled-build';

// Update check
export {
  checkForUpdate,
  getCachedUpdateCheck,
  isNewerVersion,
  parseLatestRelease,
} from './update-check';
export type { UpdateCheckResult } from './update-check';

// Tier notice (one-time CLI notice for unconfigured tier-keyword workflows)
export { readTierNoticeState, markTierNoticeShown } from './tier-notice';
export type { TierNoticeState } from './tier-notice';

// Anonymous telemetry
export {
  captureWorkflowInvoked,
  captureAnvilStarted,
  captureAnvilActive,
  captureChatTurn,
  captureApprovalResolved,
  captureCodebaseRegistered,
  captureWorkflowCompleted,
  classifyWorkflowForTelemetry,
  TELEMETRY_SCHEMA_VERSION,
  shutdownTelemetry,
  isTelemetryDisabled,
  getTelemetryStatus,
  resetTelemetryId,
} from './telemetry';
export type {
  WorkflowInvokedProperties,
  AnvilStartedProperties,
  ChatTurnProperties,
  DeploymentShapeProperties,
  WorkflowCompletedProperties,
  WorkflowExitReason,
  WorkflowErrorClass,
  WorkflowNodeType,
  WorkflowTelemetrySource,
  TelemetryStatus,
  TelemetryDisabledReason,
} from './telemetry';
