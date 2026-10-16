export interface UIMessage {
  command: string;
  operationId?: string;
}

export interface LoadSolutionMessage extends UIMessage {
  command: 'load-solution';
  solutionFilePath: string;
}

export interface UninstallMessage extends UIMessage {
  projectName: string;
  packageId: string;
}

export interface InstallMessage extends UninstallMessage {
  packageVersion: string;
  packageSourceUrl: string;
}

export interface InstallPackageInProjectsMessage extends UIMessage {
  command: 'add-package-to-projects';
  projectPaths: string[];
  packageId: string;
  packageVersion: string;
  packageSourceUrl: string;
  includeCpmExceptions?: boolean;
}

export interface RemovePackageFromProjectsMessage extends UIMessage {
  command: 'remove-package-from-projects';
  projectPaths: string[];
  packageId: string;
}

export interface PackageUpdateOperation {
  projectPaths: string[];
  packageId: string;
  packageVersion: string;
  packageSourceUrl: string;
  includeCpmExceptions?: boolean;
}

export interface UpdatePackagesMessage extends UIMessage {
  command: 'update-packages-batch';
  updates: PackageUpdateOperation[];
  buildAfterRestore: boolean;
}

export interface RollbackPackageUpdateMessage extends UIMessage {
  command: 'rollback-package-update';
  rollbackId: string;
}

export type SessionCacheKind =
  | 'service-index'
  | 'package-search'
  | 'package-summary'
  | 'package-history'
  | 'package-inventory';
export type SessionCacheKeyPart = string | boolean | number;

interface SessionCacheKey {
  cacheKind: SessionCacheKind;
  sourceUrl: string;
  authorizationHeader?: string;
  keyParts: SessionCacheKeyPart[];
}

export interface SessionCacheGetMessage extends UIMessage, SessionCacheKey {
  command: 'session-cache-get';
  requestId: string;
}

export interface SessionCacheSetMessage extends UIMessage, SessionCacheKey {
  command: 'session-cache-set';
  entryKind: 'package-data' | 'service-index';
  value: string;
}

export interface SessionCacheDeleteMessage extends UIMessage, SessionCacheKey {
  command: 'session-cache-delete';
}

export interface SessionCacheClearMessage extends UIMessage {
  command: 'session-cache-clear';
  sourceUrl: string;
}

export type WebviewMessage =
  | UIMessage
  | SessionCacheGetMessage
  | SessionCacheSetMessage
  | SessionCacheDeleteMessage
  | SessionCacheClearMessage;
