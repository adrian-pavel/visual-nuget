import { ExtensionMessage } from '../../src-common/models/extension-message';
import { PackageSource } from '../../src-common/models/package-source';
import { PackageOperationResult } from '../../src-common/models/extension-message';
import {
  InstallMessage,
  InstallPackageInProjectsMessage,
  LoadSolutionMessage,
  PackageUpdateOperation,
  RemovePackageFromProjectsMessage,
  RollbackPackageUpdateMessage,
  SessionCacheClearMessage,
  SessionCacheDeleteMessage,
  SessionCacheGetMessage,
  SessionCacheSetMessage,
  UIMessage,
  UninstallMessage,
  UpdatePackagesMessage,
} from '../../src-common/models/ui-message';
import { Project, Solution } from '../../src-common/models/project';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import ProjectFileLoader from './project-file-loader';
import SessionPackageCache from './session-package-cache';
import SessionSolutionCache from './session-solution-cache';
import { TaskManager } from './task-manager';
import SolutionLoader from './solution-loader';

interface UpdateTarget {
  projectPath: string;
  project: Project;
  update: PackageUpdateOperation;
}

interface RollbackSnapshot {
  originals: Map<string, Buffer>;
  expected: Map<string, Buffer>;
}

interface XmlAttributeRange {
  rawValue: string;
  valueStart: number;
  valueEnd: number;
  quote: '"' | "'";
}

interface XmlElementRange {
  name: string;
  attributes: Map<string, XmlAttributeRange>;
  parent?: XmlElementRange;
  selfClosing: boolean;
  contentStart: number;
  contentEnd?: number;
}

interface CentralPackageVersionChange {
  packageId: string;
  version: string;
}

const maxConcurrentMetadataLoads = 2;
const maxPendingCacheWriteTimings = 512;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function findXmlTagEnd(xml: string, start: number, trackInternalSubset = false): number | undefined {
  let quote: '"' | "'" | undefined;
  let internalSubsetDepth = 0;
  for (let index = start; index < xml.length; index++) {
    const character = xml[index];
    if (quote) {
      if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (trackInternalSubset && character === '[') {
      internalSubsetDepth++;
    } else if (trackInternalSubset && character === ']') {
      internalSubsetDepth = Math.max(0, internalSubsetDepth - 1);
    } else if (character === '>' && internalSubsetDepth === 0) {
      return index;
    }
  }
  return undefined;
}

function readXmlAttributes(xml: string, start: number, end: number): Map<string, XmlAttributeRange> | undefined {
  const attributes = new Map<string, XmlAttributeRange>();
  let index = start;
  while (index < end) {
    while (index < end && /\s/.test(xml[index] ?? '')) {
      index++;
    }
    if (index >= end || xml[index] === '/') {
      break;
    }

    const nameStart = index;
    while (index < end && !/[\s=/>]/.test(xml[index] ?? '')) {
      index++;
    }
    if (index === nameStart) {
      return undefined;
    }
    const name = xml.slice(nameStart, index).toLowerCase();
    while (index < end && /\s/.test(xml[index] ?? '')) {
      index++;
    }
    if (xml[index] !== '=') {
      return undefined;
    }
    index++;
    while (index < end && /\s/.test(xml[index] ?? '')) {
      index++;
    }

    const quote = xml[index];
    if (quote !== '"' && quote !== "'") {
      return undefined;
    }
    const valueStart = ++index;
    while (index < end && xml[index] !== quote) {
      index++;
    }
    if (index >= end || attributes.has(name)) {
      return undefined;
    }
    attributes.set(name, {
      rawValue: xml.slice(valueStart, index),
      valueStart,
      valueEnd: index,
      quote,
    });
    index++;
  }
  return attributes;
}

function scanXmlElements(xml: string): XmlElementRange[] | undefined {
  const elements: XmlElementRange[] = [];
  const stack: XmlElementRange[] = [];
  let index = 0;

  while (index < xml.length) {
    const start = xml.indexOf('<', index);
    if (start < 0) {
      break;
    }
    if (xml.startsWith('<!--', start)) {
      const commentEnd = xml.indexOf('-->', start + 4);
      if (commentEnd < 0) {
        return undefined;
      }
      index = commentEnd + 3;
      continue;
    }
    if (xml.startsWith('<![CDATA[', start)) {
      const cdataEnd = xml.indexOf(']]>', start + 9);
      if (cdataEnd < 0) {
        return undefined;
      }
      index = cdataEnd + 3;
      continue;
    }
    if (xml.startsWith('<?', start)) {
      const instructionEnd = xml.indexOf('?>', start + 2);
      if (instructionEnd < 0) {
        return undefined;
      }
      index = instructionEnd + 2;
      continue;
    }

    const declaration = xml.startsWith('<!', start);
    const end = findXmlTagEnd(xml, start + 1, declaration);
    if (end === undefined) {
      return undefined;
    }
    if (declaration) {
      index = end + 1;
      continue;
    }

    const closing = xml[start + 1] === '/';
    let nameStart = start + (closing ? 2 : 1);
    while (nameStart < end && /\s/.test(xml[nameStart] ?? '')) {
      nameStart++;
    }
    let nameEnd = nameStart;
    while (nameEnd < end && !/[\s/>]/.test(xml[nameEnd] ?? '')) {
      nameEnd++;
    }
    if (nameEnd === nameStart) {
      return undefined;
    }
    const name = xml.slice(nameStart, nameEnd);

    if (closing) {
      const element = stack.pop();
      if (!element || element.name !== name) {
        return undefined;
      }
      element.contentEnd = start;
    } else {
      const attributes = readXmlAttributes(xml, nameEnd, end);
      if (!attributes) {
        return undefined;
      }
      const selfClosing = xml.slice(nameEnd, end).trimEnd().endsWith('/');
      const element: XmlElementRange = {
        name,
        attributes,
        parent: stack.length ? stack[stack.length - 1] : undefined,
        selfClosing,
        contentStart: end + 1,
        ...(selfClosing ? { contentEnd: end + 1 } : {}),
      };
      elements.push(element);
      if (!selfClosing) {
        stack.push(element);
      }
    }
    index = end + 1;
  }

  return stack.length === 0 ? elements : undefined;
}

function decodeXmlEntities(value: string): string | undefined {
  const entityPattern = /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi;
  if (value.replace(entityPattern, '').includes('&')) {
    return undefined;
  }
  return value.replace(entityPattern, (_entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return '';
    }
  });
}

function isLiteralMsbuildValue(value: string): boolean {
  return !/[$@%]\(/.test(value);
}

function escapeXmlAttribute(value: string, quote: '"' | "'"): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(quote === '"' ? /"/g : /'/g, quote === '"' ? '&quot;' : '&apos;');
}

function escapeXmlText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function updateCentralPackageVersions(xml: string, updates: CentralPackageVersionChange[]): string | undefined {
  const elements = scanXmlElements(xml);
  if (!elements || updates.length === 0) {
    return undefined;
  }

  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const packageIds = new Set<string>();
  for (const update of updates) {
    const packageKey = update.packageId.toLowerCase();
    if (packageIds.has(packageKey)) {
      return undefined;
    }
    packageIds.add(packageKey);

    const declarations = elements.filter((element) => {
      if (element.name.toLowerCase() !== 'packageversion') {
        return false;
      }
      const include = element.attributes.get('include');
      const updateMetadata = element.attributes.get('update');
      if (include && updateMetadata) {
        return true;
      }
      const identity = include ?? updateMetadata;
      return identity !== undefined && decodeXmlEntities(identity.rawValue)?.toLowerCase() === packageKey;
    });
    if (declarations.length !== 1) {
      return undefined;
    }

    const declaration = declarations[0];
    if (!declaration) {
      return undefined;
    }
    let ancestor: XmlElementRange | undefined = declaration;
    while (ancestor) {
      if (ancestor.attributes.has('condition')) {
        return undefined;
      }
      ancestor = ancestor.parent;
    }

    const versionAttribute = declaration.attributes.get('version');
    if (versionAttribute) {
      const decodedVersion = decodeXmlEntities(versionAttribute.rawValue);
      if (decodedVersion === undefined || !isLiteralMsbuildValue(decodedVersion)) {
        return undefined;
      }
      replacements.push({
        start: versionAttribute.valueStart,
        end: versionAttribute.valueEnd,
        value: escapeXmlAttribute(update.version, versionAttribute.quote),
      });
      continue;
    }

    if (declaration.selfClosing || declaration.contentEnd === undefined) {
      return undefined;
    }
    const versionElements = elements.filter(
      (element) => element.parent === declaration && element.name.toLowerCase() === 'version'
    );
    if (versionElements.length !== 1) {
      return undefined;
    }
    const versionElement = versionElements[0];
    if (
      !versionElement ||
      versionElement.selfClosing ||
      versionElement.contentEnd === undefined ||
      versionElement.attributes.size > 0
    ) {
      return undefined;
    }
    const rawContent = xml.slice(versionElement.contentStart, versionElement.contentEnd);
    if (rawContent.includes('<')) {
      return undefined;
    }
    const leadingWhitespace = rawContent.match(/^\s*/)?.[0].length ?? 0;
    const trailingWhitespace = rawContent.match(/\s*$/)?.[0].length ?? 0;
    const literalVersion = decodeXmlEntities(rawContent.trim());
    if (literalVersion === undefined || !isLiteralMsbuildValue(literalVersion)) {
      return undefined;
    }
    replacements.push({
      start: versionElement.contentStart + leadingWhitespace,
      end: versionElement.contentEnd - trailingWhitespace,
      value: escapeXmlText(update.version),
    });
  }

  return replacements
    .sort((left, right) => right.start - left.start)
    .reduce((updatedXml, replacement) => {
      return updatedXml.slice(0, replacement.start) + replacement.value + updatedXml.slice(replacement.end);
    }, xml);
}

export default class WebviewMessageHandler {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly projectFileLoader: ProjectFileLoader;
  private readonly solutionLoader: SolutionLoader;
  private readonly taskManager: TaskManager;
  private readonly taskName = 'visual-nuget';
  private solutionProjects = new Map<string, Project>();
  private loadedSolution: Solution | undefined;
  private readonly rollbackSnapshots = new Map<string, RollbackSnapshot>();
  private readonly pendingCacheWriteStartedAt = new Map<string, number>();
  private contextLoadSequence = 0;

  public constructor(
    private readonly webview: vscode.Webview,
    private readonly context: { type: 'project' | 'solution'; filePath: string },
    private readonly sessionPackageCache = new SessionPackageCache(),
    private readonly sessionSolutionCache = new SessionSolutionCache(),
    private readonly logDiagnostic: (message: string) => void = () => {}
  ) {
    this.projectFileLoader = new ProjectFileLoader();
    this.solutionLoader = new SolutionLoader(this.projectFileLoader);
    this.taskManager = new TaskManager(() => this.loadContext());
    this.disposables.push(this.taskManager);

    this.webview.onDidReceiveMessage(
      (message: UIMessage) => {
        this.handleMessage(message);
      },
      null,
      this.disposables
    );

    vscode.workspace.onDidChangeConfiguration(
      () => {
        this.loadConfiguration();
      },
      null,
      this.disposables
    );
  }

  private handleMessage(message: UIMessage): void {
    switch (message.command) {
      case 'add-package':
        void this.addPackage(message as InstallMessage);
        return;
      case 'remove-package':
        void this.removePackage(message as UninstallMessage);
        return;
      case 'add-package-to-projects':
        void this.addPackageToProjects(message as InstallPackageInProjectsMessage);
        return;
      case 'remove-package-from-projects':
        void this.removePackageFromProjects(message as RemovePackageFromProjectsMessage);
        return;
      case 'update-packages-batch':
        void this.updatePackagesBatch(message as UpdatePackagesMessage);
        return;
      case 'rollback-package-update':
        void this.rollbackPackageUpdate(message as RollbackPackageUpdateMessage);
        return;
      case 'load-project':
        this.loadContext();
        this.loadConfiguration();
        return;
      case 'load-solution':
        this.loadSolution(message as LoadSolutionMessage);
        this.loadConfiguration();
        return;
      case 'session-cache-get':
        this.readSessionCache(message as SessionCacheGetMessage);
        return;
      case 'session-cache-set':
        this.writeSessionCache(message as SessionCacheSetMessage);
        return;
      case 'session-cache-delete':
        this.deleteSessionCache(message as SessionCacheDeleteMessage);
        return;
      case 'session-cache-clear':
        this.sessionPackageCache.clearPackageData((message as SessionCacheClearMessage).sourceUrl);
        return;
      case 'open-settings':
        this.openSettings();
    }
  }

  private readSessionCache(message: SessionCacheGetMessage): void {
    const cacheKey = this.sessionPackageCache.createKey(
      message.cacheKind,
      message.sourceUrl,
      message.authorizationHeader,
      message.keyParts
    );
    const value = this.sessionPackageCache.get(cacheKey) ?? null;
    if (this.isMetadataCacheKind(message.cacheKind)) {
      const packageCount =
        message.cacheKind === 'package-inventory' ? `, packageIds=${Math.max(0, message.keyParts.length - 2)}` : '';
      this.logDiagnostic(
        `${message.cacheKind} ${value === null ? 'MISS' : `HIT, bytes=${Buffer.byteLength(value, 'utf8')}`}${packageCount}`
      );
      if (value === null) {
        if (!this.pendingCacheWriteStartedAt.has(cacheKey) && this.pendingCacheWriteStartedAt.size >= maxPendingCacheWriteTimings) {
          const oldestKey = this.pendingCacheWriteStartedAt.keys().next().value;
          if (oldestKey !== undefined) {
            this.pendingCacheWriteStartedAt.delete(oldestKey);
          }
        }
        this.pendingCacheWriteStartedAt.set(cacheKey, Date.now());
      }
    }

    this.webview.postMessage({
      type: 'session-cache-result',
      data: {
        requestId: message.requestId,
        value,
      },
    });
  }

  private writeSessionCache(message: SessionCacheSetMessage): void {
    const cacheKey = this.sessionPackageCache.createKey(
      message.cacheKind,
      message.sourceUrl,
      message.authorizationHeader,
      message.keyParts
    );
    const startedAt = this.pendingCacheWriteStartedAt.get(cacheKey);
    this.pendingCacheWriteStartedAt.delete(cacheKey);
    const byteLength = Buffer.byteLength(message.value, 'utf8');
    const stored = this.sessionPackageCache.set(cacheKey, message.sourceUrl, message.entryKind, message.value);
    if (this.isMetadataCacheKind(message.cacheKind)) {
      const duration = startedAt === undefined ? '' : `, miss-to-store=${Date.now() - startedAt}ms`;
      this.logDiagnostic(`${message.cacheKind} ${stored ? 'STORED' : 'REJECTED'}, bytes=${byteLength}${duration}`);
    }
    if (!stored) {
      console.warn(`Visual NuGet skipped a ${message.cacheKind} session cache entry (${byteLength} bytes).`);
    }
  }

  private isMetadataCacheKind(cacheKind: SessionCacheGetMessage['cacheKind']): boolean {
    return cacheKind === 'package-inventory' || cacheKind === 'package-summary' || cacheKind === 'package-history';
  }

  private deleteSessionCache(message: SessionCacheDeleteMessage): void {
    this.sessionPackageCache.delete(
      this.sessionPackageCache.createKey(
        message.cacheKind,
        message.sourceUrl,
        message.authorizationHeader,
        message.keyParts
      )
    );
  }

  private async addPackage(message: InstallMessage): Promise<void> {
    try {
      const project = await this.loadOperationProject(message.projectName, message.operationId);
      if (!project) {
        throw new Error(`Project "${message.projectName}" is no longer available.`);
      }
      const args = project.managePackageVersionsCentrally
        ? [
            'package',
            'add',
            message.packageId,
            '--version',
            message.packageVersion,
            '--project',
            { value: project.fsPath, quoting: vscode.ShellQuoting.Strong },
            ...(message.packageSourceUrl ? ['--source', message.packageSourceUrl] : []),
          ]
        : [
            'add',
            { value: project.fsPath, quoting: vscode.ShellQuoting.Strong },
            'package',
            message.packageId,
            '-v',
            message.packageVersion,
            '-s',
            message.packageSourceUrl,
          ];
      const task = this.createDotnetTask('add', args);
      const result = await this.taskManager.executeTask(task);
      const succeeded = result.exitCode === 0;
      this.postOperationResults(
        [
          {
            projectPath: project.fsPath,
            packageId: message.packageId,
            operation: 'add',
            succeeded,
            fromVersion: this.getInstalledPackageVersion(project.fsPath, message.packageId),
            toVersion: message.packageVersion,
            message:
              result.error ??
              (succeeded
                ? undefined
                : `${project.managePackageVersionsCentrally ? 'dotnet package add' : 'dotnet add package'} exited with code ${String(result.exitCode)}.`),
          },
        ],
        undefined,
        false
      );
    } catch (error) {
      this.postOperationResults(
        [
          {
            projectPath: message.projectName,
            packageId: message.packageId,
            operation: 'add',
            succeeded: false,
            toVersion: message.packageVersion,
            message: errorMessage(error),
          },
        ],
        undefined,
        false
      );
    } finally {
      this.postOperationCompleted(message.operationId);
    }
  }

  private async removePackage(message: UninstallMessage): Promise<void> {
    try {
      const project = await this.loadOperationProject(message.projectName, message.operationId);
      if (!project) {
        throw new Error(`Project "${message.projectName}" is no longer available.`);
      }
      const args = project.managePackageVersionsCentrally
        ? [
            'package',
            'remove',
            message.packageId,
            '--project',
            { value: project.fsPath, quoting: vscode.ShellQuoting.Strong },
          ]
        : ['remove', { value: project.fsPath, quoting: vscode.ShellQuoting.Strong }, 'package', message.packageId];
      const task = this.createDotnetTask('remove', args);
      const result = await this.taskManager.executeTask(task);
      const succeeded = result.exitCode === 0;
      this.postOperationResults(
        [
          {
            projectPath: project.fsPath,
            packageId: message.packageId,
            operation: 'remove',
            succeeded,
            fromVersion: this.getInstalledPackageVersion(project.fsPath, message.packageId),
            message:
              result.error ?? (succeeded ? undefined : `dotnet remove package exited with code ${String(result.exitCode)}.`),
          },
        ],
        undefined,
        false
      );
    } catch (error) {
      this.postOperationResults(
        [
          {
            projectPath: message.projectName,
            packageId: message.packageId,
            operation: 'remove',
            succeeded: false,
            message: errorMessage(error),
          },
        ],
        undefined,
        false
      );
    } finally {
      this.postOperationCompleted(message.operationId);
    }
  }

  private async addPackageToProjects(message: InstallPackageInProjectsMessage): Promise<void> {
    const projectPaths = this.context.type === 'solution' ? message.projectPaths : [this.context.filePath];
    try {
      await this.loadOperationProjects(projectPaths, message.operationId);
      const results = await Promise.all(
        projectPaths.map(async (projectPath) => {
          const project = this.findProject(projectPath);
          if (!project) {
            return {
              projectPath,
              packageId: message.packageId,
              operation: 'add' as const,
              succeeded: false,
              toVersion: message.packageVersion,
              message: 'The project is no longer part of the loaded solution.',
            };
          }
          const isCentral = project?.managePackageVersionsCentrally === true;
          const existingPackage = project?.packages.find((item) => item.id.toLowerCase() === message.packageId.toLowerCase());
          const frameworkVersions = existingPackage?.targetFrameworkVersions ?? [];
          const hasFrameworkVersionException =
            new Set(frameworkVersions.map((item) => item.version)).size > 1 || frameworkVersions.some((item) => item.condition !== undefined);
          const hasVersionException =
            existingPackage !== undefined &&
            existingPackage.packageLevel !== 'transitive' &&
            (existingPackage.versionSource !== 'central' || hasFrameworkVersionException);
          if (this.context.type === 'solution' && isCentral && existingPackage && hasVersionException && !message.includeCpmExceptions) {
            return {
              projectPath,
              packageId: message.packageId,
              operation: 'add' as const,
              succeeded: false,
              skipped: true,
              fromVersion: existingPackage?.version,
              toVersion: message.packageVersion,
              message: 'Skipped to preserve the existing project override or target-framework-specific version. Enable CPM exception changes to include it.',
            };
          }
          const args = isCentral
            ? [
                'package',
                'add',
                message.packageId,
                '--version',
                message.packageVersion,
                '--project',
                { value: project.fsPath, quoting: vscode.ShellQuoting.Strong },
                ...(message.packageSourceUrl ? ['--source', message.packageSourceUrl] : []),
              ]
            : [
                'add',
                { value: project.fsPath, quoting: vscode.ShellQuoting.Strong },
                'package',
                message.packageId,
                '-v',
                message.packageVersion,
                ...(message.packageSourceUrl ? ['-s', message.packageSourceUrl] : []),
              ];
          return this.executePackageTask(project.fsPath, message.packageId, 'add', args, {
            fromVersion: existingPackage?.version,
            toVersion: message.packageVersion,
          });
        })
      );
      this.postOperationResults(results, undefined, false);
    } catch (error) {
      this.postOperationResults(
        projectPaths.map((projectPath) => ({
          projectPath,
          packageId: message.packageId,
          operation: 'add' as const,
          succeeded: false,
          toVersion: message.packageVersion,
          message: errorMessage(error),
        })),
        undefined,
        false
      );
    } finally {
      this.postOperationCompleted(message.operationId);
    }
  }

  private async updatePackagesBatch(message: UpdatePackagesMessage): Promise<void> {
    const results: PackageOperationResult[] = [];
    let originalSnapshots: Map<string, Buffer> | undefined;
    let updatedSnapshots: Map<string, Buffer> | undefined;
    let attemptedUpdates = 0;
    let rollbackId: string | undefined;

    try {
      await this.loadOperationProjects(message.updates.flatMap((update) => update.projectPaths), message.operationId);
      const targets = this.resolveUpdateTargets(message.updates, results);
      if (targets.length > 0) {
        const affectedFiles = this.getAffectedPackageFiles(targets);
        this.ensureNoDirtyDocuments(affectedFiles);
        originalSnapshots = await this.captureFileSnapshots(affectedFiles);

        await this.taskManager.executeBatch(async () => {
          const directlyUpdatedTargets = new Set<UpdateTarget>();
          const centralFileGroups = this.groupCpmTargetsByVersionFile(targets);
          for (let index = 0; index < centralFileGroups.length; index++) {
            const fileGroup = centralFileGroups[index];
            if (!fileGroup) {
              continue;
            }
            const updates = this.getCentralPackageVersionChanges(fileGroup.targets);
            const originalSnapshot = originalSnapshots?.get(path.resolve(fileGroup.filePath));
            if (!updates || !originalSnapshot) {
              continue;
            }

            const originalContents = originalSnapshot.toString('utf8');
            const updatedContents = updateCentralPackageVersions(originalContents, updates);
            if (updatedContents === undefined) {
              continue;
            }

            this.postOperationProgress(
              message.operationId,
              `Updating ${updates.length} central package version${updates.length === 1 ? '' : 's'} in ${path.basename(fileGroup.filePath)} (${index + 1} of ${centralFileGroups.length})…`
            );
            const currentContents = await fs.readFile(fileGroup.filePath);
            if (!currentContents.equals(originalSnapshot)) {
              throw new Error(`Central package version file changed during the update: ${fileGroup.filePath}`);
            }
            attemptedUpdates += fileGroup.targets.length;
            if (updatedContents !== originalContents) {
              await fs.writeFile(fileGroup.filePath, updatedContents, 'utf8');
            }
            for (const target of fileGroup.targets) {
              directlyUpdatedTargets.add(target);
              results.push({
                projectPath: target.projectPath,
                packageId: target.update.packageId,
                operation: 'add',
                succeeded: true,
                fromVersion: this.getInstalledPackageVersion(target.projectPath, target.update.packageId),
                toVersion: target.update.packageVersion,
              });
            }
          }

          const updateGroups = this.groupUpdateTargetsByCentralPackage(
            targets.filter((target) => !directlyUpdatedTargets.has(target))
          );
          for (let index = 0; index < updateGroups.length; index++) {
            const group = updateGroups[index];
            const target = group[0];
            if (!target) {
              continue;
            }
            this.postOperationProgress(
              message.operationId,
              group.length > 1
                ? `Updating ${target.update.packageId} centrally for ${group.length} projects (${index + 1} of ${updateGroups.length})…`
                : `Updating ${target.update.packageId} (${index + 1} of ${updateGroups.length})…`
            );
            attemptedUpdates++;
            const result = await this.executePackageTask(
              target.projectPath,
              target.update.packageId,
              'add',
              this.createPackageAddArguments(target, true),
              {
                fromVersion: this.getInstalledPackageVersion(target.projectPath, target.update.packageId),
                toVersion: target.update.packageVersion,
              }
            );
            if (result.succeeded) {
              attemptedUpdates += group.length - 1;
              results.push(
                ...group.map((groupTarget) => ({
                  ...result,
                  projectPath: groupTarget.projectPath,
                  fromVersion: this.getInstalledPackageVersion(groupTarget.projectPath, groupTarget.update.packageId),
                }))
              );
            } else {
              results.push({
                ...result,
                projectPath: target.projectPath,
                fromVersion: this.getInstalledPackageVersion(target.projectPath, target.update.packageId),
              });
              for (const fallbackTarget of group.slice(1)) {
                this.postOperationProgress(
                  message.operationId,
                  `Updating ${fallbackTarget.update.packageId} in ${fallbackTarget.project.name} after the central update failed…`
                );
                attemptedUpdates++;
                const fallbackResult = await this.executePackageTask(
                  fallbackTarget.projectPath,
                  fallbackTarget.update.packageId,
                  'add',
                  this.createPackageAddArguments(fallbackTarget, true),
                  {
                    fromVersion: this.getInstalledPackageVersion(fallbackTarget.projectPath, fallbackTarget.update.packageId),
                    toVersion: fallbackTarget.update.packageVersion,
                  }
                );
                results.push(fallbackResult);
              }
            }
          }

          if (attemptedUpdates > 0 && originalSnapshots) {
            updatedSnapshots = await this.captureFileSnapshots(Array.from(originalSnapshots.keys()));
          }

          this.postOperationProgress(message.operationId, 'Restoring packages…');
          const restoreResult = await this.executeValidationTask('restore', ['restore', this.quotedContextPath()]);
          if (!restoreResult.succeeded && message.buildAfterRestore) {
            restoreResult.message = `${restoreResult.message ?? 'Restore failed.'} Build was not run because restore failed.`;
          }
          results.push(restoreResult);

          if (message.buildAfterRestore && restoreResult.succeeded) {
            const packageEditsFailed = results.some(
              (result) => result.operation === 'add' && !result.succeeded && !result.skipped
            );
            if (packageEditsFailed) {
              results.push({
                projectPath: this.context.filePath,
                packageId: '(batch)',
                operation: 'build',
                succeeded: false,
                skipped: true,
                message: 'Build was not run because one or more package updates failed.',
              });
            } else {
              this.postOperationProgress(message.operationId, 'Building after restore…');
              results.push(
                await this.executeValidationTask('build', ['build', this.quotedContextPath(), '--no-restore'])
              );
            }
          }
        });

        if (
          results.some((result) => !result.succeeded && !result.skipped) &&
          attemptedUpdates > 0 &&
          originalSnapshots &&
          updatedSnapshots
        ) {
          if (this.haveSnapshotsChanged(originalSnapshots, updatedSnapshots)) {
            rollbackId = randomUUID();
            this.rollbackSnapshots.set(rollbackId, { originals: originalSnapshots, expected: updatedSnapshots });
            while (this.rollbackSnapshots.size > 5) {
              const oldestId = this.rollbackSnapshots.keys().next().value;
              if (oldestId) {
                this.rollbackSnapshots.delete(oldestId);
              }
            }
          }
        }
      } else if (results.length === 0) {
        results.push({
          projectPath: this.context.filePath,
          packageId: '(batch)',
          operation: 'add',
          succeeded: false,
          message: 'No package updates were available to apply.',
        });
      }
    } catch (error) {
      results.push({
        projectPath: this.context.filePath,
        packageId: '(batch)',
        operation: 'add',
        succeeded: false,
        message: `The package update batch could not be completed: ${error instanceof Error ? error.message : String(error)}`,
      });

      if (originalSnapshots && attemptedUpdates > 0) {
        try {
          updatedSnapshots ??= await this.captureFileSnapshots(Array.from(originalSnapshots.keys()));
          if (this.haveSnapshotsChanged(originalSnapshots, updatedSnapshots)) {
            rollbackId = randomUUID();
            this.rollbackSnapshots.set(rollbackId, { originals: originalSnapshots, expected: updatedSnapshots });
          }
        } catch (snapshotError) {
          results.push({
            projectPath: this.context.filePath,
            packageId: '(batch)',
            operation: 'rollback',
            succeeded: false,
            message: `A rollback point could not be created: ${snapshotError instanceof Error ? snapshotError.message : String(snapshotError)}`,
          });
        }
      }
    } finally {
      this.postOperationResults(results, rollbackId, false);
      this.postOperationCompleted(message.operationId);
    }
  }

  private resolveUpdateTargets(updates: PackageUpdateOperation[], results: PackageOperationResult[]): UpdateTarget[] {
    const targets: UpdateTarget[] = [];
    for (const update of updates) {
      for (const projectPath of update.projectPaths) {
        const project = this.findProject(projectPath);
        if (!project) {
          results.push({
            projectPath,
            packageId: update.packageId,
            operation: 'add',
            succeeded: false,
            toVersion: update.packageVersion,
            message: 'The project is no longer part of the loaded solution.',
          });
          continue;
        }

        const existingPackage = project.packages.find((item) => item.id.toLowerCase() === update.packageId.toLowerCase());
        if (!existingPackage || existingPackage.packageLevel === 'transitive') {
          results.push({
            projectPath,
            packageId: update.packageId,
            operation: 'add',
            succeeded: false,
            skipped: true,
            fromVersion: existingPackage?.version,
            toVersion: update.packageVersion,
            message: 'Skipped because the package is no longer a direct package reference in this project.',
          });
          continue;
        }
        if (existingPackage.version === update.packageVersion) {
          results.push({
            projectPath,
            packageId: update.packageId,
            operation: 'add',
            succeeded: true,
            skipped: true,
            fromVersion: existingPackage.version,
            toVersion: update.packageVersion,
            message: 'The package is already at the selected version.',
          });
          continue;
        }

        if (
          project.managePackageVersionsCentrally &&
          this.hasCpmVersionException(existingPackage) &&
          !update.includeCpmExceptions
        ) {
          results.push({
            projectPath,
            packageId: update.packageId,
            operation: 'add',
            succeeded: false,
            skipped: true,
            fromVersion: existingPackage.version,
            toVersion: update.packageVersion,
            message: 'Skipped to preserve the existing project override or target-framework-specific version. Enable CPM exception changes to include it.',
          });
          continue;
        }

        targets.push({ projectPath: project.fsPath, project, update });
      }
    }
    return targets;
  }

  private groupUpdateTargetsByCentralPackage(targets: UpdateTarget[]): UpdateTarget[][] {
    const groups: UpdateTarget[][] = [];
    const groupsByKey = new Map<string, UpdateTarget[]>();

    for (const target of targets) {
      const groupKey = this.getCentralPackageGroupKey(target);
      if (groupKey === undefined) {
        groups.push([target]);
        continue;
      }

      const existingGroup = groupsByKey.get(groupKey);
      if (existingGroup) {
        existingGroup.push(target);
      } else {
        const group = [target];
        groupsByKey.set(groupKey, group);
        groups.push(group);
      }
    }

    return groups;
  }

  private groupCpmTargetsByVersionFile(targets: UpdateTarget[]): Array<{ filePath: string; targets: UpdateTarget[] }> {
    const groups = new Map<string, { filePath: string; targets: UpdateTarget[] }>();
    for (const target of targets) {
      const filePath = this.getCentralPackageVersionFilePath(target);
      if (!filePath) {
        continue;
      }
      const key = path.resolve(filePath).toLowerCase();
      const group = groups.get(key);
      if (group) {
        group.targets.push(target);
      } else {
        groups.set(key, { filePath, targets: [target] });
      }
    }
    return Array.from(groups.values());
  }

  private getCentralPackageVersionChanges(targets: UpdateTarget[]): CentralPackageVersionChange[] | undefined {
    const changes = new Map<string, CentralPackageVersionChange>();
    for (const target of targets) {
      const key = target.update.packageId.toLowerCase();
      const existingChange = changes.get(key);
      if (existingChange && existingChange.version !== target.update.packageVersion) {
        return undefined;
      }
      changes.set(key, { packageId: target.update.packageId, version: target.update.packageVersion });
    }
    return Array.from(changes.values());
  }

  private getCentralPackageVersionFilePath(target: UpdateTarget): string | undefined {
    if (!target.project.managePackageVersionsCentrally) {
      return undefined;
    }

    const installedPackage = target.project.packages.find(
      (item) => item.id.toLowerCase() === target.update.packageId.toLowerCase()
    );
    if (
      !installedPackage ||
      installedPackage.versionSource !== 'central' ||
      this.hasCpmVersionException(installedPackage) ||
      !installedPackage.targetFrameworkVersions?.length ||
      installedPackage.targetFrameworkVersions.some((item) => item.centralVersionDefinitionCount !== 1)
    ) {
      return undefined;
    }

    const centralVersionFiles = [
      installedPackage.versionFilePath,
      ...(installedPackage.targetFrameworkVersions ?? []).map((item) => item.versionFilePath),
    ].filter((filePath): filePath is string => filePath !== undefined && filePath.length > 0);
    const normalizedFiles = new Map(centralVersionFiles.map((filePath) => [path.resolve(filePath).toLowerCase(), filePath]));
    return normalizedFiles.size === 1 ? Array.from(normalizedFiles.values())[0] : undefined;
  }

  private getCentralPackageGroupKey(target: UpdateTarget): string | undefined {
    if (target.update.includeCpmExceptions) {
      return undefined;
    }
    const centralVersionFilePath = this.getCentralPackageVersionFilePath(target);
    if (!centralVersionFilePath) {
      return undefined;
    }

    return JSON.stringify([
      path.resolve(centralVersionFilePath).toLowerCase(),
      target.update.packageId.toLowerCase(),
      target.update.packageVersion,
      target.update.packageSourceUrl,
    ]);
  }

  private hasCpmVersionException(existingPackage: Project['packages'][number]): boolean {
    const frameworkVersions = existingPackage.targetFrameworkVersions ?? [];
    const hasFrameworkVersionException =
      new Set(frameworkVersions.map((item) => item.version)).size > 1 ||
      frameworkVersions.some((item) => item.condition !== undefined);
    return existingPackage.versionSource !== 'central' || hasFrameworkVersionException;
  }

  private createPackageAddArguments(target: UpdateTarget, noRestore: boolean): (string | vscode.ShellQuotedString)[] {
    const sourceArguments = target.update.packageSourceUrl
      ? target.project.managePackageVersionsCentrally
        ? ['--source', target.update.packageSourceUrl]
        : ['-s', target.update.packageSourceUrl]
      : [];
    const noRestoreArguments = noRestore ? ['--no-restore'] : [];
    if (target.project.managePackageVersionsCentrally) {
      return [
        'package',
        'add',
        target.update.packageId,
        '--version',
        target.update.packageVersion,
        '--project',
        { value: target.projectPath, quoting: vscode.ShellQuoting.Strong },
        ...sourceArguments,
        ...noRestoreArguments,
      ];
    }
    return [
      'add',
      { value: target.projectPath, quoting: vscode.ShellQuoting.Strong },
      'package',
      target.update.packageId,
      '-v',
      target.update.packageVersion,
      ...sourceArguments,
      ...noRestoreArguments,
    ];
  }

  private getAffectedPackageFiles(targets: UpdateTarget[]): string[] {
    const filePaths = new Map<string, string>();
    for (const target of targets) {
      const installedPackage = target.project.packages.find(
        (item) => item.id.toLowerCase() === target.update.packageId.toLowerCase()
      );
      const packageFilePaths = [
        installedPackage?.versionFilePath,
        ...(installedPackage?.targetFrameworkVersions ?? []).map((item) => item.versionFilePath),
      ].filter((filePath): filePath is string => filePath !== undefined && filePath.length > 0);

      if (target.project.managePackageVersionsCentrally && packageFilePaths.length === 0) {
        throw new Error(`Could not determine the central version file for ${target.update.packageId} in ${target.projectPath}.`);
      }
      if (packageFilePaths.length === 0) {
        packageFilePaths.push(target.projectPath);
      }
      packageFilePaths.forEach((filePath) => filePaths.set(path.resolve(filePath).toLowerCase(), path.resolve(filePath)));
    }
    return Array.from(filePaths.values());
  }

  private ensureNoDirtyDocuments(filePaths: string[]): void {
    const normalizedPaths = new Set(filePaths.map((filePath) => path.resolve(filePath).toLowerCase()));
    const dirtyDocument = vscode.workspace.textDocuments.find(
      (document) => document.isDirty && normalizedPaths.has(path.resolve(document.uri.fsPath).toLowerCase())
    );
    if (dirtyDocument) {
      throw new Error(`Save ${dirtyDocument.uri.fsPath} before updating packages.`);
    }
  }

  private async captureFileSnapshots(filePaths: string[]): Promise<Map<string, Buffer>> {
    const snapshots = new Map<string, Buffer>();
    for (const filePath of filePaths) {
      const normalizedPath = path.resolve(filePath);
      snapshots.set(normalizedPath, await fs.readFile(normalizedPath));
    }
    return snapshots;
  }

  private haveSnapshotsChanged(originals: Map<string, Buffer>, expected: Map<string, Buffer>): boolean {
    return Array.from(originals.entries()).some(([filePath, content]) => !expected.get(filePath)?.equals(content));
  }

  private findProject(projectPath: string): Project | undefined {
    const directMatch = this.solutionProjects.get(projectPath);
    if (directMatch) {
      return directMatch;
    }
    const normalizedPath = path.resolve(projectPath).toLowerCase();
    return Array.from(this.solutionProjects.values()).find((project) => path.resolve(project.fsPath).toLowerCase() === normalizedPath);
  }

  private async loadOperationProject(
    projectPath: string,
    operationId?: string,
    refreshContext = true
  ): Promise<Project | undefined> {
    const project = this.findProject(projectPath);
    if (!project || project.packageMetadataComplete !== false) {
      return project;
    }
    this.postOperationProgress(operationId, `Loading package metadata for ${project.name}...`);
    const projectWithMetadata = await this.projectFileLoader.loadProjectAsync(project.fsPath);
    this.solutionProjects.set(project.fsPath, projectWithMetadata);
    if (refreshContext) {
      this.postLoadedContext();
    }
    return projectWithMetadata;
  }

  private async loadOperationProjects(projectPaths: string[], operationId?: string): Promise<void> {
    const uniquePaths = Array.from(
      new Map(projectPaths.map((projectPath) => [path.resolve(projectPath).toLowerCase(), projectPath])).values()
    );
    const metadataNeeded = uniquePaths.some((projectPath) => this.findProject(projectPath)?.packageMetadataComplete === false);
    let nextIndex = 0;
    const failures: string[] = [];
    const loadNext = async (): Promise<void> => {
      while (nextIndex < uniquePaths.length) {
        const projectPath = uniquePaths[nextIndex++];
        try {
          await this.loadOperationProject(projectPath, operationId, false);
        } catch (error) {
          failures.push(`${projectPath}: ${errorMessage(error)}`);
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(maxConcurrentMetadataLoads, uniquePaths.length) }, () => loadNext())
    );
    if (failures.length > 0) {
      throw new Error(`Could not load project metadata required for this operation: ${failures.join('; ')}`);
    }
    if (metadataNeeded) {
      this.postLoadedContext();
    }
  }

  private postLoadedContext(): void {
    if (this.context.type === 'project') {
      const project = this.findProject(this.context.filePath);
      if (project) {
        this.webview.postMessage({ type: 'project', data: project });
      }
      return;
    }
    if (!this.loadedSolution) {
      return;
    }
    this.loadedSolution = {
      ...this.loadedSolution,
      projects: this.loadedSolution.projects.map((project) => this.findProject(project.fsPath) ?? project),
    };
    this.webview.postMessage({ type: 'solution', data: this.loadedSolution });
  }

  private getInstalledPackageVersion(projectPath: string, packageId: string): string | undefined {
    return this.findProject(projectPath)?.packages.find((item) => item.id.toLowerCase() === packageId.toLowerCase())?.version;
  }

  private quotedContextPath(): vscode.ShellQuotedString {
    return { value: this.context.filePath, quoting: vscode.ShellQuoting.Strong };
  }

  private createDotnetTask(operation: string, args: (string | vscode.ShellQuotedString)[]): vscode.Task {
    const task = new vscode.Task(
      { type: 'dotnet', task: operation },
      vscode.TaskScope.Workspace,
      this.taskName,
      'dotnet',
      new vscode.ShellExecution('dotnet', args)
    );
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Never, focus: false };
    return task;
  }

  private async executeValidationTask(
    operation: 'restore' | 'build',
    args: (string | vscode.ShellQuotedString)[]
  ): Promise<PackageOperationResult> {
    const task = this.createDotnetTask(operation, args);
    const result = await this.taskManager.executeTask(task);
    const succeeded = result.exitCode === 0;
    return {
      projectPath: this.context.filePath,
      packageId: '(batch)',
      operation,
      succeeded,
      message: result.error ?? (succeeded ? undefined : `dotnet ${operation} exited with code ${String(result.exitCode)}.`),
    };
  }

  private postOperationProgress(operationId: string | undefined, message: string): void {
    if (!operationId) {
      return;
    }
    const extensionMessage: ExtensionMessage = {
      type: 'operation-progress',
      data: { operationId, message },
    };
    this.webview.postMessage(extensionMessage);
  }

  private async rollbackPackageUpdate(message: RollbackPackageUpdateMessage): Promise<void> {
    const results: PackageOperationResult[] = [];
    const snapshot = this.rollbackSnapshots.get(message.rollbackId);
    try {
      if (!snapshot) {
        throw new Error('This rollback is no longer available. The package files may have changed or the extension was reloaded.');
      }

      const filePaths = Array.from(snapshot.expected.keys());
      this.ensureNoDirtyDocuments(filePaths);
      const currentSnapshots = await this.captureFileSnapshots(filePaths);
      const changedFiles = filePaths.filter((filePath) => {
        const expectedContent = snapshot.expected.get(filePath);
        return expectedContent === undefined || !currentSnapshots.get(filePath)?.equals(expectedContent);
      });
      if (changedFiles.length > 0) {
        throw new Error(`Rollback cancelled because these files changed after the update: ${changedFiles.join(', ')}`);
      }

      await this.taskManager.executeBatch(async () => {
        this.postOperationProgress(message.operationId, 'Restoring the original package files…');
        for (const [filePath, content] of snapshot.originals) {
          await this.writeFileAtomically(filePath, content);
        }
        this.postOperationProgress(message.operationId, 'Restoring dependencies after rollback…');
        const restoreResult = await this.executeValidationTask('restore', ['restore', this.quotedContextPath()]);
        results.push({
          projectPath: this.context.filePath,
          packageId: '(rollback)',
          operation: 'rollback',
          succeeded: restoreResult.succeeded,
          message: restoreResult.succeeded ? 'Original package files were restored and dependencies were restored.' : `Original package files were restored, but dotnet restore failed: ${restoreResult.message}`,
        });
      });
    } catch (error) {
      results.push({
        projectPath: this.context.filePath,
        packageId: '(rollback)',
        operation: 'rollback',
        succeeded: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.rollbackSnapshots.delete(message.rollbackId);
      this.postOperationResults(results, undefined, false);
      this.postOperationCompleted(message.operationId);
    }
  }

  private async writeFileAtomically(filePath: string, content: Buffer): Promise<void> {
    const temporaryFilePath = `${filePath}.${randomUUID()}.visual-nuget.tmp`;
    const mode = (await fs.stat(filePath)).mode;
    try {
      await fs.writeFile(temporaryFilePath, content, { mode, flag: 'wx' });
      await fs.rename(temporaryFilePath, filePath);
    } finally {
      await fs.rm(temporaryFilePath, { force: true });
    }
  }

  private async removePackageFromProjects(message: RemovePackageFromProjectsMessage): Promise<void> {
    try {
      await this.loadOperationProjects(message.projectPaths, message.operationId);
      const results = await Promise.all(
        message.projectPaths.map((projectPath) => {
          const project = this.findProject(projectPath);
          if (!project) {
            return {
              projectPath,
              packageId: message.packageId,
              operation: 'remove' as const,
              succeeded: false,
              message: 'The project is no longer part of the loaded solution.',
            };
          }
          const existingPackage = project?.packages.find((item) => item.id.toLowerCase() === message.packageId.toLowerCase());
          if (!existingPackage || existingPackage.packageLevel === 'transitive') {
            return {
              projectPath: project.fsPath,
              packageId: message.packageId,
              operation: 'remove' as const,
              succeeded: false,
              skipped: true,
              fromVersion: existingPackage?.version,
              message: 'Skipped because the package is no longer a direct package reference in this project.',
            };
          }
          const args = project?.managePackageVersionsCentrally
            ? ['package', 'remove', message.packageId, '--project', { value: project.fsPath, quoting: vscode.ShellQuoting.Strong }]
            : ['remove', { value: project.fsPath, quoting: vscode.ShellQuoting.Strong }, 'package', message.packageId];
          return this.executePackageTask(project.fsPath, message.packageId, 'remove', args, {
            fromVersion: existingPackage?.version,
          });
        })
      );
      this.postOperationResults(results, undefined, false);
    } catch (error) {
      this.postOperationResults(
        message.projectPaths.map((projectPath) => ({
          projectPath,
          packageId: message.packageId,
          operation: 'remove' as const,
          succeeded: false,
          message: errorMessage(error),
        })),
        undefined,
        false
      );
    } finally {
      this.postOperationCompleted(message.operationId);
    }
  }

  private async executePackageTask(
    projectPath: string,
    packageId: string,
    operation: 'add' | 'remove',
    args: (string | vscode.ShellQuotedString)[],
    versionChange?: Pick<PackageOperationResult, 'fromVersion' | 'toVersion'>
  ): Promise<PackageOperationResult> {
    const task = this.createDotnetTask(operation, args);
    const result = await this.taskManager.executeTask(task);
    const succeeded = result.exitCode === 0;
    return {
      projectPath,
      packageId,
      operation,
      succeeded,
      ...versionChange,
      message: result.error ?? (succeeded ? undefined : `dotnet exited with code ${String(result.exitCode)}.`),
    };
  }

  private postOperationResults(results: PackageOperationResult[], rollbackId?: string, reloadContext = true): void {
    if (
      results.some(
        (result) => result.succeeded && (result.operation === 'add' || result.operation === 'remove' || result.operation === 'rollback')
      )
    ) {
      const cachedEntryCount = this.sessionSolutionCache.entryCount;
      this.sessionSolutionCache.clear();
      if (cachedEntryCount > 0) {
        this.logDiagnostic(`solution-inventory INVALIDATED, reason=successful-package-edit, entries=${cachedEntryCount}`);
      }
    }
    const message: ExtensionMessage = {
      type: 'operation-results',
      data: results,
      rollbackId,
    };
    this.webview.postMessage(message);
    if (reloadContext) {
      this.loadContext();
    }
  }

  private postOperationCompleted(operationId: string | undefined): void {
    if (!operationId) {
      return;
    }
    const message: ExtensionMessage = {
      type: 'operation-completed',
      data: { operationId },
    };
    this.webview.postMessage(message);
  }

  private loadContext(): void {
    const requestId = ++this.contextLoadSequence;
    if (this.context.type === 'solution') {
      this.loadSolution({ command: 'load-solution', solutionFilePath: this.context.filePath }, requestId);
      return;
    }

    this.postContextLoading('Loading project and package references...');
    this.postContextLoading('Loading project package references...');
    void this.loadProjectInventory().then(
      (project) => {
        if (requestId !== this.contextLoadSequence) {
          return;
        }
        this.solutionProjects = new Map([[project.fsPath, project]]);
        this.loadedSolution = undefined;
        const message: ExtensionMessage = { type: 'project', data: project };
        this.webview.postMessage(message);
      },
      (error: unknown) => {
        if (requestId !== this.contextLoadSequence) {
          return;
        }
        this.postContextLoadError(error);
      }
    );
  }

  private async loadProjectInventory(): Promise<Project> {
    try {
      return await this.projectFileLoader.loadProjectInventoryAsync(this.context.filePath);
    } catch (inventoryError) {
      this.postContextLoading(
        `Fast package listing failed (${errorMessage(inventoryError)}); loading project metadata...`
      );
      try {
        return await this.projectFileLoader.loadProjectAsync(this.context.filePath);
      } catch (metadataError) {
        const inventoryMessage = inventoryError instanceof Error ? inventoryError.message : String(inventoryError);
        const metadataMessage = metadataError instanceof Error ? metadataError.message : String(metadataError);
        throw new Error(`Package inventory failed (${inventoryMessage}); detailed project loading also failed (${metadataMessage}).`);
      }
    }
  }

  private loadSolution(message: LoadSolutionMessage, requestId = ++this.contextLoadSequence): void {
    const cachedSolution = this.sessionSolutionCache.get(message.solutionFilePath);
    if (cachedSolution) {
      this.logDiagnostic(`solution-inventory HIT, projects=${cachedSolution.projects.length}`);
      this.postLoadedSolution(cachedSolution, requestId);
      return;
    }

    const startedAt = Date.now();
    this.logDiagnostic('solution-inventory MISS');
    this.postContextLoading('Finding projects in solution...');
    void this.sessionSolutionCache
      .getOrLoad(message.solutionFilePath, () =>
        this.solutionLoader.loadSolutionAsync(message.solutionFilePath, ({ completed, total, message: progressMessage }) => {
          if (requestId === this.contextLoadSequence) {
            this.postContextLoading(
              progressMessage ?? `Loading solution projects (${completed} of ${total})...`,
              completed,
              total
            );
          }
        })
      )
      .then(
      (solution) => {
        const retained = this.sessionSolutionCache.get(message.solutionFilePath) === solution;
        this.logDiagnostic(
          `solution-inventory LOAD_COMPLETE, projects=${solution.projects.length}, retained=${retained}, duration=${Date.now() - startedAt}ms`
        );
        this.postLoadedSolution(solution, requestId);
      },
      (error: unknown) => {
        this.logDiagnostic(`solution-inventory LOAD_FAILED, duration=${Date.now() - startedAt}ms`);
        if (requestId === this.contextLoadSequence) {
          this.postContextLoadError(error);
        }
      }
    );
  }

  private postLoadedSolution(solution: Solution, requestId: number): void {
    if (requestId !== this.contextLoadSequence) {
      return;
    }
    this.loadedSolution = solution;
    this.solutionProjects = new Map(solution.projects.map((project) => [project.fsPath, project]));
    const extensionMessage: ExtensionMessage = { type: 'solution', data: solution };
    this.webview.postMessage(extensionMessage);
  }

  private postContextLoading(message: string, completed?: number, total?: number): void {
    const extensionMessage: ExtensionMessage = {
      type: 'context-loading',
      data: { message, completed, total },
    };
    this.webview.postMessage(extensionMessage);
  }

  private postContextLoadError(error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    const extensionMessage: ExtensionMessage = {
      type: 'context-load-error',
      data: { message: detail },
    };
    this.webview.postMessage(extensionMessage);
    vscode.window.showErrorMessage(`Error loading ${this.context.type}: ${detail}`);
  }

  private loadConfiguration(): void {
    const configuration = vscode.workspace.getConfiguration('VisualNuGet');
    try {
      const sourcesStrings = configuration['sources'];

      const sources = [];

      for (const sourceSt of sourcesStrings) {
        const source = JSON.parse(sourceSt) as PackageSource;
        sources.push(source);
      }

      const message: ExtensionMessage = { type: 'sources', data: sources };

      this.webview.postMessage(message);
    } catch (error) {
      vscode.window.showErrorMessage(`Error parsing Visual NuGet settings: ${error}`);
    }
  }

  private openSettings(): void {
    vscode.commands.executeCommand('workbench.action.openSettings', '@ext:fullstackspider.visual-nuget');
  }

  public dispose(): void {
    this.pendingCacheWriteStartedAt.clear();
    while (this.disposables.length) {
      const disposable = this.disposables.pop();
      if (disposable) {
        disposable.dispose();
      }
    }
  }
}
