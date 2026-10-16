import { PackageSource } from './package-source';
import { Project, Solution } from './project';

export type ExtensionMessage =
  | { type: 'project'; data: Project }
  | { type: 'solution'; data: Solution }
  | { type: 'context-loading'; data: { message: string; completed?: number; total?: number } }
  | { type: 'context-load-error'; data: { message: string } }
  | { type: 'sources'; data: PackageSource[] }
  | { type: 'operation-results'; data: PackageOperationResult[]; rollbackId?: string }
  | { type: 'operation-progress'; data: { operationId: string; message: string } }
  | { type: 'operation-completed'; data: { operationId: string } }
  | { type: 'session-cache-result'; data: { requestId: string; value: string | null } }
  | { type: 'session-cache-error'; data: { requestId: string; message: string } };

export interface PackageOperationResult {
  projectPath: string;
  packageId: string;
  operation: 'add' | 'remove' | 'restore' | 'build' | 'rollback';
  succeeded: boolean;
  skipped?: boolean;
  fromVersion?: string;
  toVersion?: string;
  message?: string;
}
