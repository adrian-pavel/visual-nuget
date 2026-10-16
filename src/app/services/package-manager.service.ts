import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of, Subscription } from 'rxjs';
import { map, switchMap } from 'rxjs/operators';
import { coerce } from 'semver';

import { Category } from '../models/category';
import { PackageRowModel } from '../models/package-row-model';
import { PackageSource } from '../../../src-common/models/package-source';
import { InstalledPackage, PackageLevel, Project, Solution } from '../../../src-common/models/project';
import {
  InstallMessage,
  InstallPackageInProjectsMessage,
  RemovePackageFromProjectsMessage,
  RollbackPackageUpdateMessage,
  UIMessage,
  UninstallMessage,
  UpdatePackagesMessage,
} from '../../../src-common/models/ui-message';
import { PackageOperationResult } from '../../../src-common/models/extension-message';
import { NuGetApiService } from './nuget-api.service';
import { VersionService } from './version.service';
import { VscodeService } from './vscode.service';

export interface UpdateCountState {
  count: number | null;
  loading: boolean;
  error?: string;
}

export interface ContextLoadingState {
  message: string;
  completed?: number;
  total?: number;
  error?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PackageManagerService {
  private _currentSources = new BehaviorSubject<PackageSource[]>([]);
  public get currentSources(): Observable<PackageSource[]> {
    return this._currentSources.asObservable();
  }

  private _currentCategory = new BehaviorSubject<Category>(Category.Browse);
  public get currentCategory(): Observable<Category> {
    return this._currentCategory.asObservable();
  }

  private _currentProject = new BehaviorSubject<Project | null>(null);
  public get currentProject(): Observable<Project | null> {
    return this._currentProject.asObservable();
  }

  private _currentSolution = new BehaviorSubject<Solution | null>(null);
  public get currentSolution(): Observable<Solution | null> {
    return this._currentSolution.asObservable();
  }

  private _operationResults = new BehaviorSubject<PackageOperationResult[]>([]);
  public get operationResults(): Observable<PackageOperationResult[]> {
    return this._operationResults.asObservable();
  }

  private _rollbackId = new BehaviorSubject<string | null>(null);
  public get rollbackId(): Observable<string | null> {
    return this._rollbackId.asObservable();
  }

  private _packageOperationInProgress = new BehaviorSubject(false);
  public get packageOperationInProgress(): Observable<boolean> {
    return this._packageOperationInProgress.asObservable();
  }
  public get isPackageOperationInProgress(): boolean {
    return this._packageOperationInProgress.value;
  }

  private _packageOperationProgress = new BehaviorSubject<string | null>(null);
  public get packageOperationProgress(): Observable<string | null> {
    return this._packageOperationProgress.asObservable();
  }

  private _availableUpdateCount = new BehaviorSubject<UpdateCountState>({ count: null, loading: false });
  public get availableUpdateCount(): Observable<UpdateCountState> {
    return this._availableUpdateCount.asObservable();
  }

  public get consolidationCount(): number {
    return this.getConsolidatablePackageIds().size;
  }

  private _currentPackages = new BehaviorSubject<PackageRowModel[] | null>(null);
  public get currentPackages(): Observable<PackageRowModel[] | null> {
    return this._currentPackages.asObservable();
  }

  private _currentPackagesError = new BehaviorSubject<string | null>(null);
  public get currentPackagesError(): Observable<string | null> {
    return this._currentPackagesError.asObservable();
  }

  private _packageQueryLoading = new BehaviorSubject(false);
  public get packageQueryLoading(): Observable<boolean> {
    return this._packageQueryLoading.asObservable();
  }

  private _contextLoading = new BehaviorSubject<ContextLoadingState | null>({
    message: 'Loading project and package references...',
  });
  public get contextLoading(): Observable<ContextLoadingState | null> {
    return this._contextLoading.asObservable();
  }

  private _currentSelectedPackage = new BehaviorSubject<PackageRowModel | null>(null);
  public get currentSelectedPackage(): Observable<PackageRowModel | null> {
    return this._currentSelectedPackage.asObservable();
  }

  private _currentSelectedPackageError = new BehaviorSubject<string | null>(null);
  public get currentSelectedPackageError(): Observable<string | null> {
    return this._currentSelectedPackageError.asObservable();
  }

  private _currentSelectedPackageId = new BehaviorSubject<string | null>(null);
  public get currentSelectedPackageId(): Observable<string | null> {
    return this._currentSelectedPackageId.asObservable();
  }

  private _currentSource: PackageSource | undefined;
  private _currentPrerelease = false;
  private readonly packageProjectSelections = new Map<string, string[]>();
  private readonly pendingPackageOperations = new Set<string>();
  private readonly packageOperationProgressMessages = new Map<string, string>();
  private packageOperationSequence = 0;
  private packageQuerySequence = 0;
  private packageQuerySubscription: Subscription | undefined;
  private updateCountRequestSequence = 0;
  private lastUpdateCountKey: string | undefined;
  private initialPackageMetadataLoadPending = true;
  private packageResultsCache = new Map<string, { packages: PackageRowModel[]; updateCount?: number }>();
  private warmedPackageInfo: { key: string; packages: PackageRowModel[]; updateCount: number } | undefined;

  constructor(
    private nugetService: NuGetApiService,
    private versionService: VersionService,
    private vscodeService: VscodeService
  ) {
    // tell the extension to load the project and it's installed packages
    // now we are sure the UI is loaded and ready to receive the message
    vscodeService.postMessage({
      command: 'load-project',
    });
  }

  public queryForPackages(
    query: string,
    prerelease: boolean,
    source: PackageSource,
    forceRefresh = true,
    refreshFeed = false
  ): void {
    const currentCategory = this._currentCategory.value;
    this._currentSource = source;
    this._currentPrerelease = prerelease;

    if (currentCategory !== Category.Browse && !this._currentProject.value && !this._currentSolution.value) {
      return;
    }

    const cacheKey = this.packageResultsCacheKey(query, prerelease, source, currentCategory);
    if (!forceRefresh) {
      const cachedResult = this.packageResultsCache.get(cacheKey);
      if (cachedResult) {
        this.packageQuerySubscription?.unsubscribe();
        this.packageQuerySubscription = undefined;
        this.packageQuerySequence++;
        this._currentSelectedPackage.next(null);
        this._currentPackagesError.next(null);
        this._currentSelectedPackageError.next(null);
        this._packageQueryLoading.next(false);
        if (cachedResult.updateCount !== undefined) {
          this._availableUpdateCount.next({ count: cachedResult.updateCount, loading: false });
        }
        this.setCurrentPackages(this.copyPackageRows(cachedResult.packages), true);
        return;
      }
    } else {
      this.packageResultsCache.clear();
      if (refreshFeed) {
        this.warmedPackageInfo = undefined;
        this.lastUpdateCountKey = undefined;
        this.nugetService.clearPackageCache(source);
      }
    }

    this.packageQuerySubscription?.unsubscribe();
    this.packageQuerySubscription = undefined;
    const requestId = ++this.packageQuerySequence;
    const selectedPackageId = this._currentSelectedPackageId.value;
    this._currentSelectedPackage.next(null);
    this._currentSelectedPackageId.next(selectedPackageId);
    this._currentPackages.next(null);
    this._currentPackagesError.next(null);
    this._packageQueryLoading.next(true);
    this._currentSelectedPackageError.next(null);

    const installedQueryCanShareMetadata = currentCategory === Category.Installed && !query.trim();
    if (currentCategory === Category.Updates) {
      this._availableUpdateCount.next({ count: null, loading: true });
    } else if (installedQueryCanShareMetadata) {
      this._availableUpdateCount.next({ count: null, loading: true });
    } else {
      this.refreshAvailableUpdateCount();
    }

    if (currentCategory === Category.Browse) {
      this.packageQuerySubscription = this.nugetService.search(query, prerelease, source).subscribe({
        next: (packageRowModels: PackageRowModel[]) => {
          if (requestId !== this.packageQuerySequence) {
            return;
          }
          this._currentPackagesError.next(null);
          this._packageQueryLoading.next(false);
          this.setCurrentPackages(packageRowModels);
          this.cachePackageResults(cacheKey, packageRowModels);
        },
        error: () => {
          if (requestId === this.packageQuerySequence) {
            this._packageQueryLoading.next(false);
            this.setPackageQueryError();
          }
        },
      });
    } else {
      const currentInstalledPackageIds =
        currentCategory === Category.Consolidate ? this.getDirectInstalledPackageIds() : this.getCurrentInstalledPackageIds();
      if (currentInstalledPackageIds.length) {
        const allLocalInstalledPackages =
          currentCategory === Category.Installed ? this.getLocalInstalledPackages(source.url) : [];
        const localInstalledPackages = allLocalInstalledPackages.filter((packageRow) => this.packageRowMatchesQuery(packageRow, query));
        const warmedPackageInfo = this.getWarmedPackageInfo(source, prerelease);
        if (currentCategory === Category.Installed && !warmedPackageInfo) {
          this.setCurrentPackages(localInstalledPackages);
        }

        const packageIds = new Set(currentInstalledPackageIds.map((packageId) => packageId.toLowerCase()));
        const packageLookup = warmedPackageInfo
          ? of(
              warmedPackageInfo.packages.filter(
                (packageRow) =>
                  packageIds.has(packageRow.id.toLowerCase()) && this.packageRowMatchesQuery(packageRow, query)
              )
            )
          : this.nugetService.searchByPackageIds(currentInstalledPackageIds, query, prerelease, source, false);
        const packageResults =
          !warmedPackageInfo && (currentCategory === Category.Updates || installedQueryCanShareMetadata)
            ? packageLookup.pipe(switchMap((packages) => this.resolveConstrainedUpdateCandidates(packages, source, prerelease)))
            : packageLookup;
        this.packageQuerySubscription = packageResults.subscribe({
            next: (packageRowModels: PackageRowModel[]) => {
              if (requestId !== this.packageQuerySequence) {
                return;
              }
              const loadedPackageRows = packageRowModels;
              this._currentPackagesError.next(null);
              this._packageQueryLoading.next(false);
              let updateCount: number | undefined;
              if (currentCategory === Category.Updates) {
                const packagesWithUpdates = packageRowModels.filter(
                  (packageRow) => packageRow.version.length > 0 && this.hasDirectUpdate(packageRow)
                );
                if (!query.trim() && warmedPackageInfo) {
                  updateCount = warmedPackageInfo.updateCount;
                } else {
                  updateCount = new Set(packagesWithUpdates.map((packageRow) => packageRow.id.toLowerCase())).size;
                }
                packageRowModels = packagesWithUpdates;
                this._availableUpdateCount.next({ count: updateCount, loading: false });
              } else if (installedQueryCanShareMetadata) {
                if (warmedPackageInfo) {
                  updateCount = warmedPackageInfo.updateCount;
                } else {
                  const updatedPackageIds = new Set(
                    packageRowModels
                      .filter((packageRow) => packageRow.version.length > 0 && this.hasDirectUpdate(packageRow))
                      .map((packageRow) => packageRow.id.toLowerCase())
                  );
                  updateCount = updatedPackageIds.size;
                }
                this._availableUpdateCount.next({ count: updateCount, loading: false });
              }
              if (
                !query.trim() &&
                warmedPackageInfo === undefined &&
                (currentCategory === Category.Updates || installedQueryCanShareMetadata)
              ) {
                this.storeWarmedPackageInfo(source, prerelease, loadedPackageRows, updateCount ?? 0);
              }
              if (currentCategory === Category.Installed) {
                packageRowModels = this.mergeWithLocalInstalledPackages(
                  packageRowModels,
                  localInstalledPackages,
                  allLocalInstalledPackages
                );
              }
              if (currentCategory !== Category.Updates) {
                packageRowModels = this.filterResultsToMatchCategory(packageRowModels);
              }
              this.setCurrentPackages(packageRowModels);
              this.cachePackageResults(cacheKey, packageRowModels, updateCount);
            },
            error: () => {
              if (requestId === this.packageQuerySequence) {
                this._packageQueryLoading.next(false);
                if (currentCategory === Category.Updates) {
                  this._availableUpdateCount.next({
                    count: null,
                    loading: false,
                    error: 'Could not load available updates from the selected source.',
                  });
                } else if (installedQueryCanShareMetadata) {
                  this._availableUpdateCount.next({
                    count: null,
                    loading: false,
                    error: 'Could not load available updates from the selected source.',
                  });
                }
                this.setPackageQueryError();
              }
            },
          });
      } else {
        this._packageQueryLoading.next(false);
        if (currentCategory === Category.Updates) {
          this._availableUpdateCount.next({ count: 0, loading: false });
        } else if (installedQueryCanShareMetadata) {
          this._availableUpdateCount.next({ count: 0, loading: false });
        }
        this.setCurrentPackages([]);
        this.cachePackageResults(
          cacheKey,
          [],
          currentCategory === Category.Updates || installedQueryCanShareMetadata ? 0 : undefined
        );
      }
    }
  }

  public changeCurrentProject(project: Project) {
    this._contextLoading.next(null);
    this._currentSolution.next(null);
    this.packageProjectSelections.clear();
    this.packageResultsCache.clear();
    this._currentProject.next(project);
    this.resetUnavailableConsolidateCategory();
    this.refreshAvailableUpdateCount();

    const currentPackages = this._currentPackages.value;
    if (currentPackages && project.packages.length) {
      this.setInstalledInformation(currentPackages);
    }
  }

  public changeCurrentSolution(solution: Solution): void {
    this._contextLoading.next(null);
    const previousSolution = this._currentSolution.value;
    this._currentProject.next(null);
    this._currentSolution.next(solution);
    this.packageResultsCache.clear();
    if (previousSolution?.fsPath !== solution.fsPath) {
      this.packageProjectSelections.clear();
    } else {
      const projectPaths = new Set(solution.projects.map((project) => project.fsPath));
      this.packageProjectSelections.forEach((paths, key) => {
        this.packageProjectSelections.set(key, paths.filter((projectPath) => projectPaths.has(projectPath)));
      });
    }
    this.resetUnavailableConsolidateCategory();
    this.refreshAvailableUpdateCount();

    const currentPackages = this._currentPackages.value;
    if (currentPackages) {
      this.setInstalledInformation(currentPackages);
    }
  }

  public selectedProjectsForPackage(packageId: string): string[] {
    const solution = this._currentSolution.value;
    if (!solution) {
      return [];
    }
    return [...(this.packageProjectSelections.get(this.packageSelectionKey(solution, packageId)) ?? [])];
  }

  public selectProjectsForPackage(packageId: string, projectPaths: string[]): void {
    const solution = this._currentSolution.value;
    if (!solution) {
      return;
    }
    const knownPaths = new Set(solution.projects.map((project) => project.fsPath));
    const selectedPaths = Array.from(new Set(projectPaths)).filter((projectPath) => knownPaths.has(projectPath));
    this.packageProjectSelections.set(this.packageSelectionKey(solution, packageId), selectedPaths);
  }

  public setOperationResults(results: PackageOperationResult[], rollbackId?: string): void {
    this._operationResults.next(results);
    this._rollbackId.next(rollbackId ?? null);
  }

  public dismissOperationResults(): void {
    if (this.isPackageOperationInProgress) {
      return;
    }
    this._operationResults.next([]);
    this._rollbackId.next(null);
  }

  public setPackageOperationProgress(operationId: string, message: string): void {
    if (!this.pendingPackageOperations.has(operationId)) {
      return;
    }
    this.packageOperationProgressMessages.set(operationId, message);
    this.updatePackageOperationProgress();
  }

  public completePackageOperation(operationId: string): void {
    if (this.pendingPackageOperations.delete(operationId)) {
      this.packageOperationProgressMessages.delete(operationId);
      this._packageOperationInProgress.next(this.pendingPackageOperations.size > 0);
      this.updatePackageOperationProgress();
    }
  }

  public changeCurrentSources(sources: PackageSource[]): void {
    this._currentSources.next(sources);
  }

  public setContextLoading(message: string, completed?: number, total?: number): void {
    this.packageQuerySubscription?.unsubscribe();
    this.packageQuerySubscription = undefined;
    this.packageQuerySequence++;
    this.updateCountRequestSequence++;
    this.lastUpdateCountKey = undefined;
    this._availableUpdateCount.next({ count: null, loading: false });
    this._contextLoading.next({ message, completed, total });
    this._packageQueryLoading.next(false);
    this._currentPackagesError.next(null);
  }

  public setContextLoadError(message: string): void {
    this.packageQuerySubscription?.unsubscribe();
    this.packageQuerySubscription = undefined;
    this.packageQuerySequence++;
    this.updateCountRequestSequence++;
    this.lastUpdateCountKey = undefined;
    this._contextLoading.next({ message, error: true });
    this._currentPackages.next(null);
    this._packageQueryLoading.next(false);
    this._currentPackagesError.next(null);
    this._availableUpdateCount.next({ count: null, loading: false });
  }

  public changeCurrentSelectedPackage(selectedPackage: PackageRowModel | null): void {
    this._currentSelectedPackageError.next(null);
    // set the current selected package id so that the list highlights it
    this._currentSelectedPackageId.next(selectedPackage?.id ?? null);
    // set the current selected package to null to clear the details pane
    this._currentSelectedPackage.next(null);

    // if no package selected or if the versions/metadata for the package are already loaded, just display it
    if (selectedPackage == null || selectedPackage.versions !== undefined) {
      this._currentSelectedPackage.next(selectedPackage);
    } else if (this._currentSource) {
      // else query the api for the package metadata and use the versions from the result
      this.nugetService.searchByPackageIds([selectedPackage.id], '', this._currentPrerelease, this._currentSource).subscribe({
        next: (results) => {
          const packageWithVersions = results.find((result) => result.id.toLowerCase() === selectedPackage.id.toLowerCase());
          if (!packageWithVersions) {
            this._currentSelectedPackageError.next(
              'Package details were not returned by the selected source. Check the source settings and retry.'
            );
            return;
          }
          selectedPackage.version = packageWithVersions.version;
          selectedPackage.description = packageWithVersions.description;
          selectedPackage.authors = packageWithVersions.authors;
          selectedPackage.iconUrl = packageWithVersions.iconUrl;
          selectedPackage.totalDownloads = packageWithVersions.totalDownloads;
          selectedPackage.verified = packageWithVersions.verified;
          selectedPackage.sourceUrl = packageWithVersions.sourceUrl;
          selectedPackage.versions = packageWithVersions.versions;
          selectedPackage.vulnerabilities = packageWithVersions.vulnerabilities ?? selectedPackage.vulnerabilities;
          selectedPackage.deprecation = packageWithVersions.deprecation ?? selectedPackage.deprecation;
          this.setInstalledInformation([selectedPackage]);
          const currentPackages = this._currentPackages.value;
          if (currentPackages?.includes(selectedPackage)) {
            this._currentPackages.next([...currentPackages]);
          }
          this._currentSelectedPackage.next(selectedPackage);
        },
        error: () => {
          this._currentSelectedPackageError.next(
            'Package details could not be loaded from the selected source. Check the source settings or connection and retry.'
          );
        },
      });
    }
  }

  public changeCurrentCategory(category: Category): void {
    this._currentCategory.next(category);
  }

  public installPackage(packageToInstall: PackageRowModel | null, version?: string, projectPaths?: string[], includeCpmExceptions = false) {
    if (packageToInstall === null || this.isPackageOperationInProgress) {
      return;
    }
    const requestedVersion = version ?? packageToInstall.version;
    const currentSolution = this._currentSolution.value;
    let selectedPaths = projectPaths ?? this.selectedProjectsForPackage(packageToInstall.id);
    if (currentSolution) {
      selectedPaths = selectedPaths.filter((projectPath) => {
        const installedPackage = currentSolution.projects
          .find((project) => project.fsPath === projectPath)
          ?.packages.find((item) => item.id.toLowerCase() === packageToInstall.id.toLowerCase());
        return (
          !installedPackage ||
          installedPackage.packageLevel === 'transitive' ||
          this.isVersionAllowedForInstalledPackage(installedPackage, requestedVersion)
        );
      });
    } else {
      const installedPackage = this._currentProject.value?.packages.find(
        (item) => item.id.toLowerCase() === packageToInstall.id.toLowerCase()
      );
      if (
        installedPackage &&
        installedPackage.packageLevel !== 'transitive' &&
        !this.isVersionAllowedForInstalledPackage(installedPackage, requestedVersion)
      ) {
        return;
      }
    }
    if (currentSolution && selectedPaths.length === 0) {
      return;
    }
    const installMessage = this.mapPackageToInstallMessage(packageToInstall, version, selectedPaths, includeCpmExceptions);

    this.postPackageOperation(installMessage);
  }

  public installPackages(packagesToInstall: PackageRowModel[], buildAfterRestore = false): void {
    if (packagesToInstall.length <= 0 || this.isPackageOperationInProgress) {
      return;
    }

    const updates = packagesToInstall.flatMap((packageToInstall) => {
      const currentSolution = this._currentSolution.value;
      if (currentSolution) {
        const selectedPaths = new Set(this.selectedProjectsForPackage(packageToInstall.id));
        const projectPaths = currentSolution.projects
          .filter((project) => selectedPaths.size === 0 || selectedPaths.has(project.fsPath))
          .filter((project) => this.isDirectOutdatedPackage(project.packages, packageToInstall))
          .map((project) => project.fsPath);
        return projectPaths.length > 0
          ? [
              {
                projectPaths,
                packageId: packageToInstall.id,
                packageVersion: packageToInstall.version,
                packageSourceUrl: packageToInstall.sourceUrl,
              },
            ]
          : [];
      }

      const currentProject = this._currentProject.value;
      if (!currentProject || !this.isDirectOutdatedPackage(currentProject.packages, packageToInstall)) {
        return [];
      }
      return [
        {
          projectPaths: [currentProject.fsPath],
          packageId: packageToInstall.id,
          packageVersion: packageToInstall.version,
          packageSourceUrl: packageToInstall.sourceUrl,
          ...(currentProject.managePackageVersionsCentrally ? { includeCpmExceptions: true } : {}),
        },
      ];
    });

    if (updates.length === 0) {
      return;
    }

    const message: UpdatePackagesMessage = {
      command: 'update-packages-batch',
      updates,
      buildAfterRestore,
    };
    this.postPackageOperation(message);
  }

  public rollbackPackageUpdate(rollbackId: string): void {
    if (this.isPackageOperationInProgress || !rollbackId) {
      return;
    }
    const message: RollbackPackageUpdateMessage = { command: 'rollback-package-update', rollbackId };
    this.postPackageOperation(message);
    this._rollbackId.next(null);
  }

  public uninstallPackage(packageToUninstall: PackageRowModel | null, projectPaths?: string[]) {
    if (packageToUninstall === null || this.isPackageOperationInProgress) {
      return;
    }

    const currentSolution = this._currentSolution.value;
    if (currentSolution) {
      const selectedPaths = new Set(projectPaths ?? this.selectedProjectsForPackage(packageToUninstall.id));
      const targetPaths = currentSolution.projects
        .filter(
          (project) =>
            selectedPaths.has(project.fsPath) &&
            project.packages.some(
              (installedPackage) =>
                installedPackage.id.toLowerCase() === packageToUninstall.id.toLowerCase() && installedPackage.packageLevel !== 'transitive'
            )
        )
        .map((project) => project.fsPath);
      if (targetPaths.length > 0) {
        const message: RemovePackageFromProjectsMessage = {
          command: 'remove-package-from-projects',
          projectPaths: targetPaths,
          packageId: packageToUninstall.id,
        };
        this.postPackageOperation(message);
      }
      return;
    }

    const currentProject = this._currentProject.value;
    if (currentProject?.managePackageVersionsCentrally) {
      const message: RemovePackageFromProjectsMessage = {
        command: 'remove-package-from-projects',
        projectPaths: [currentProject.fsPath],
        packageId: packageToUninstall.id,
      };
      this.postPackageOperation(message);
      return;
    }

    this.postPackageOperation({
      command: 'remove-package',
      projectName: currentProject?.fsPath ?? '',
      packageId: packageToUninstall.id,
    } as UninstallMessage);
  }

  private mapPackageToInstallMessage(
    packageToInstall: PackageRowModel,
    version?: string,
    projectPaths: string[] = [],
    includeCpmExceptions = false
  ): InstallMessage | InstallPackageInProjectsMessage {
    const currentSolution = this._currentSolution.value;
    if (currentSolution) {
      const message: InstallPackageInProjectsMessage = {
        command: 'add-package-to-projects',
        projectPaths: [...projectPaths],
        packageId: packageToInstall.id,
        packageVersion: version ?? packageToInstall.version,
        packageSourceUrl: packageToInstall.sourceUrl,
        includeCpmExceptions,
      };
      return message;
    }

    const currentProject = this._currentProject.value;
    if (!currentProject) {
      throw new Error('Current project cannot be undefined');
    }

    // if no specific version is provided just install the latest on the package
    const versionToInstall = version ?? packageToInstall.version;

    if (currentProject.managePackageVersionsCentrally) {
      return {
        command: 'add-package-to-projects',
        projectPaths: [currentProject.fsPath],
        packageId: packageToInstall.id,
        packageVersion: versionToInstall,
        packageSourceUrl: packageToInstall.sourceUrl,
        includeCpmExceptions: true,
      };
    }

    return {
      command: 'add-package',
      projectName: currentProject.fsPath,
      packageId: packageToInstall.id,
      packageVersion: versionToInstall,
      packageSourceUrl: packageToInstall.sourceUrl,
    };
  }

  private packageSelectionKey(solution: Solution, packageId: string): string {
    return `${solution.fsPath.toLowerCase()}|${packageId.toLowerCase()}`;
  }

  private setPackageQueryError(): void {
    const message = 'Packages could not be loaded from the selected source. Check the source settings or connection, then refresh.';
    this._currentPackagesError.next(message);
    if (this._currentSelectedPackageId.value) {
      this._currentSelectedPackageError.next(message);
    }
  }

  private postPackageOperation(message: UIMessage): void {
    this.packageResultsCache.clear();
    this.warmedPackageInfo = undefined;
    this.lastUpdateCountKey = undefined;
    if (message.command !== 'rollback-package-update') {
      this._operationResults.next([]);
      this._rollbackId.next(null);
    }
    const operationId = `${Date.now().toString(36)}-${(++this.packageOperationSequence).toString(36)}`;
    this.pendingPackageOperations.add(operationId);
    this._packageOperationInProgress.next(true);
    this._packageOperationProgress.next(null);
    try {
      this.vscodeService.postMessage({ ...message, operationId });
    } catch (error) {
      this.completePackageOperation(operationId);
      throw error;
    }
  }

  private setInstalledInformation(packageRowModels: PackageRowModel[]): void {
    const currentSolution = this._currentSolution.value;
    if (currentSolution) {
      const packagesByProject = currentSolution.projects.map(
        (project) => new Map(project.packages.map((installedPackage) => [installedPackage.id.toLowerCase(), installedPackage]))
      );
      packageRowModels.forEach((packageRowModel) => {
        const packageId = packageRowModel.id.toLowerCase();
        const installedPackages = packagesByProject.map((packages) => packages.get(packageId));
        const projectStates = currentSolution.projects.map((project, index) => {
          const installedPackage = installedPackages[index];
          return {
            projectPath: project.fsPath,
            projectName: project.name,
            isInstalled: installedPackage !== undefined,
            isDirectlyInstalled: installedPackage !== undefined && installedPackage.packageLevel !== 'transitive',
            installedVersion: installedPackage?.version ?? '',
            versionSource: installedPackage?.versionSource,
            packageLevel: installedPackage?.packageLevel,
            managePackageVersionsCentrally: project.managePackageVersionsCentrally,
            targetFrameworkVersions: installedPackage?.targetFrameworkVersions,
            packageListWarning: project.packageListWarning,
          };
        });
        const installedStates = projectStates.filter((state) => state.isInstalled);
        const installedVersions = new Set(installedStates.map((state) => state.installedVersion));
        const versionSources = new Set(installedStates.map((state) => state.versionSource).filter((source) => source !== undefined));
        packageRowModel.solutionProjectStates = projectStates;
        packageRowModel.isInstalled = installedStates.length > 0;
        packageRowModel.installedVersion =
          installedVersions.size === 1 ? installedStates[0].installedVersion : installedVersions.size > 1 ? 'Varies by project' : '';
        packageRowModel.versionSource = versionSources.size === 1 ? Array.from(versionSources)[0] : versionSources.size > 1 ? 'mixed' : undefined;
        const packageLevels = new Set<PackageLevel>(installedStates.flatMap((state) => (state.packageLevel ? [state.packageLevel] : [])));
        packageRowModel.packageLevel = packageLevels.size === 1 ? Array.from(packageLevels)[0] : packageLevels.size > 1 ? 'mixed' : undefined;
        packageRowModel.isOutdated = installedPackages.some(
          (installedPackage) =>
            installedPackage !== undefined &&
            installedPackage.packageLevel !== 'transitive' &&
            this.hasNewerVersion(installedPackage.version, packageRowModel.version) &&
            this.isVersionAllowedForInstalledPackage(installedPackage, packageRowModel.version)
        );
      });
      return;
    }

    const currentInstalledPackages = this._currentProject.value?.packages;

    if (currentInstalledPackages) {
      const packagesById = new Map(currentInstalledPackages.map((installedPackage) => [installedPackage.id.toLowerCase(), installedPackage]));
      packageRowModels.forEach((packageRowModel: PackageRowModel) => {
        const installedPackage = packagesById.get(packageRowModel.id.toLowerCase());

        packageRowModel.isInstalled = installedPackage !== undefined;
        packageRowModel.installedVersion = installedPackage ? installedPackage.version : '';
        packageRowModel.versionSource = installedPackage?.versionSource;
        packageRowModel.packageLevel = installedPackage?.packageLevel;
        packageRowModel.isOutdated =
          installedPackage !== undefined &&
          installedPackage.packageLevel !== 'transitive' &&
          this.hasNewerVersion(installedPackage.version, packageRowModel.version) &&
          this.isVersionAllowedForInstalledPackage(installedPackage, packageRowModel.version);
      });
    }
  }

  private setCurrentPackages(packageRowModels: PackageRowModel[], installedInformationComplete = false): void {
    if (!installedInformationComplete) {
      this.setInstalledInformation(packageRowModels);
    }
    this._currentPackages.next(packageRowModels);

    const selectedPackageId = this._currentSelectedPackageId.value;
    const selectedPackage = selectedPackageId
      ? packageRowModels.find((packageRow) => packageRow.id.toLowerCase() === selectedPackageId.toLowerCase()) ?? null
      : null;
    this.changeCurrentSelectedPackage(selectedPackage);
  }

  private getLocalInstalledPackages(sourceUrl: string): PackageRowModel[] {
    const projects = this._currentSolution.value
      ? this._currentSolution.value.projects
      : this._currentProject.value
        ? [this._currentProject.value]
        : [];
    const installedById = new Map<string, InstalledPackage[]>();

    projects.forEach((project) => {
      project.packages.forEach((installedPackage) => {
        const key = installedPackage.id.toLowerCase();
        const entries = installedById.get(key) ?? [];
        entries.push(installedPackage);
        installedById.set(key, entries);
      });
    });

    return Array.from(installedById.values())
      .map((entries) => {
        const versions = new Set(entries.map((entry) => entry.version));
        const packageLevels = new Set(entries.map((entry) => entry.packageLevel ?? 'unknown'));
        const packageLevel: PackageLevel =
          packageLevels.size > 1 ? 'mixed' : (Array.from(packageLevels)[0] ?? 'unknown');
        const version = versions.size === 1 ? entries[0].version : 'Varies by project';
        return {
          id: entries[0].id,
          version,
          description: '',
          authors: [],
          iconUrl: '',
          totalDownloads: undefined,
          verified: false,
          isInstalled: true,
          installedVersion: version,
          isOutdated: false,
          sourceUrl,
          packageLevel,
          versions: undefined,
        };
      })
      .sort((first, second) => first.id.localeCompare(second.id));
  }

  private mergeWithLocalInstalledPackages(
    packageRowModels: PackageRowModel[],
    localInstalledPackages: PackageRowModel[],
    allLocalInstalledPackages: PackageRowModel[]
  ): PackageRowModel[] {
    const packagesById = new Map(localInstalledPackages.map((packageRow) => [packageRow.id.toLowerCase(), packageRow]));
    const allLocalPackagesById = new Map(allLocalInstalledPackages.map((packageRow) => [packageRow.id.toLowerCase(), packageRow]));
    packageRowModels.forEach((packageRow) => {
      const packageId = packageRow.id.toLowerCase();
      const localPackage = packagesById.get(packageId) ?? allLocalPackagesById.get(packageId);
      packagesById.set(
        packageId,
        localPackage && !packageRow.version
          ? { ...localPackage, ...packageRow, version: localPackage.version, installedVersion: localPackage.installedVersion }
          : packageRow
      );
    });
    return Array.from(packagesById.values()).sort((first, second) => first.id.localeCompare(second.id));
  }

  private packageRowMatchesQuery(packageRow: PackageRowModel, query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    return !normalizedQuery || packageRow.id.toLowerCase().includes(normalizedQuery) || packageRow.description.toLowerCase().includes(normalizedQuery);
  }

  private packageResultsCacheKey(query: string, prerelease: boolean, source: PackageSource, category: Category): string {
    return JSON.stringify([
      category,
      query,
      prerelease,
      source.url,
      source.authorizationHeader ?? '',
      category === Category.Browse ? '' : this.getInstalledPackageDataKey(source, prerelease),
    ]);
  }

  private cachePackageResults(key: string, packages: PackageRowModel[], updateCount?: number): void {
    this.packageResultsCache.set(key, { packages: this.copyPackageRows(packages), updateCount });
  }

  private copyPackageRows(packages: PackageRowModel[]): PackageRowModel[] {
    return packages.map((packageRow) => ({
      ...packageRow,
      versions: packageRow.versions ? [...packageRow.versions] : undefined,
      solutionProjectStates: packageRow.solutionProjectStates?.map((state) => ({
        ...state,
        targetFrameworkVersions: state.targetFrameworkVersions?.map((version) => ({ ...version })),
      })),
    }));
  }

  private getInstalledPackageDataKey(source: PackageSource, prerelease: boolean): string {
    const projects = this._currentSolution.value
      ? this._currentSolution.value.projects
      : this._currentProject.value
        ? [this._currentProject.value]
        : [];
    const installedPackages = projects.flatMap((project) =>
      project.packages.map((installedPackage) => ({
        projectPath: project.fsPath.toLowerCase(),
        id: installedPackage.id.toLowerCase(),
        version: installedPackage.version,
        packageLevel: installedPackage.packageLevel ?? '',
        requestedVersions: (installedPackage.targetFrameworkVersions ?? [])
          .filter((frameworkVersion) => frameworkVersion.packageLevel !== 'transitive')
          .map((frameworkVersion) => frameworkVersion.requestedVersion ?? '')
          .sort(),
      }))
    );
    installedPackages.sort(
      (left, right) =>
        left.projectPath.localeCompare(right.projectPath) ||
        left.id.localeCompare(right.id) ||
        left.version.localeCompare(right.version)
    );
    return JSON.stringify([
      source.url,
      source.authorizationHeader ?? '',
      prerelease,
      ...installedPackages,
    ]);
  }

  private getWarmedPackageInfo(
    source: PackageSource,
    prerelease: boolean
  ): { packages: PackageRowModel[]; updateCount: number } | undefined {
    const key = this.getInstalledPackageDataKey(source, prerelease);
    return this.warmedPackageInfo?.key === key ? this.warmedPackageInfo : undefined;
  }

  private storeWarmedPackageInfo(source: PackageSource, prerelease: boolean, packages: PackageRowModel[], updateCount: number): void {
    this.warmedPackageInfo = {
      key:             this.getInstalledPackageDataKey(source, prerelease),
      packages: this.copyPackageRows(packages),
      updateCount,
    };
  }

  private filterResultsToMatchCategory(packageRowModels: PackageRowModel[]): PackageRowModel[] {
    const currentCategory = this._currentCategory.value;

    if (currentCategory === Category.Consolidate) {
      const consolidatablePackageIds = this.getConsolidatablePackageIds();
      return packageRowModels.filter(
        (packageRowModel) => packageRowModel.version.length > 0 && consolidatablePackageIds.has(packageRowModel.id.toLowerCase())
      );
    }

    return packageRowModels;
  }

  private getCurrentInstalledPackageIds(): string[] {
    return Array.from(
      new Map(this.getCurrentInstalledPackages().map((installedPackage) => [installedPackage.id.toLowerCase(), installedPackage.id])).values()
    );
  }

  private getCurrentInstalledPackages(): Array<{ id: string; version: string; projectPath: string }> {
    const currentSolution = this._currentSolution.value;
    if (currentSolution) {
      return currentSolution.projects.flatMap((project) =>
        project.packages.map((installedPackage) => ({
          id: installedPackage.id,
          version: installedPackage.version,
          projectPath: project.fsPath,
        }))
      );
    }

    const currentProject = this._currentProject.value;
    return (
      currentProject?.packages.map((installedPackage: InstalledPackage) => ({
        id: installedPackage.id,
        version: installedPackage.version,
        projectPath: currentProject.fsPath,
      })) ?? []
    );
  }

  private getDirectInstalledPackages(): Array<{ id: string; version: string; projectPath: string }> {
    const currentSolution = this._currentSolution.value;
    if (currentSolution) {
      return currentSolution.projects.flatMap((project) =>
        project.packages
          .filter((installedPackage) => installedPackage.packageLevel !== 'transitive')
          .map((installedPackage) => ({ id: installedPackage.id, version: installedPackage.version, projectPath: project.fsPath }))
      );
    }

    const currentProject = this._currentProject.value;
    return (
      currentProject?.packages
        .filter((installedPackage) => installedPackage.packageLevel !== 'transitive')
        .map((installedPackage) => ({ id: installedPackage.id, version: installedPackage.version, projectPath: currentProject.fsPath })) ?? []
    );
  }

  private getDirectInstalledPackageIds(): string[] {
    return Array.from(
      new Map(this.getDirectInstalledPackages().map((installedPackage) => [installedPackage.id.toLowerCase(), installedPackage.id])).values()
    );
  }

  private isDirectOutdatedPackage(installedPackages: InstalledPackage[], packageToUpdate: PackageRowModel): boolean {
    const installedPackage = installedPackages.find((item) => item.id.toLowerCase() === packageToUpdate.id.toLowerCase());
    return (
      installedPackage !== undefined &&
      installedPackage.packageLevel !== 'transitive' &&
      this.hasNewerVersion(installedPackage.version, packageToUpdate.version) &&
      this.isVersionAllowedForInstalledPackage(installedPackage, packageToUpdate.version)
    );
  }

  private hasNewerVersion(installedVersion: string, candidateVersion: string): boolean {
    if (installedVersion === candidateVersion) {
      return false;
    }

    const comparison = this.versionService.compareSemVers(installedVersion, candidateVersion);
    if (comparison !== 0) {
      return comparison === 1;
    }

    return coerce(installedVersion) === null || coerce(candidateVersion) === null;
  }

  private getDirectInstalledPackagesForId(packageId: string): InstalledPackage[] {
    const projects = this._currentSolution.value
      ? this._currentSolution.value.projects
      : this._currentProject.value
        ? [this._currentProject.value]
        : [];
    return projects.flatMap((project) =>
      project.packages.filter(
        (installedPackage) =>
          installedPackage.id.toLowerCase() === packageId.toLowerCase() && installedPackage.packageLevel !== 'transitive'
      )
    );
  }

  private getDeclaredVersionRanges(installedPackage: InstalledPackage): string[] {
    return Array.from(
      new Set(
        (installedPackage.targetFrameworkVersions ?? [])
          .filter((frameworkVersion) => frameworkVersion.packageLevel !== 'transitive')
          .flatMap((frameworkVersion) => (frameworkVersion.requestedVersion ? [frameworkVersion.requestedVersion] : []))
      )
    );
  }

  private isVersionAllowedForInstalledPackage(installedPackage: InstalledPackage, candidateVersion: string): boolean {
    return this.getDeclaredVersionRanges(installedPackage).every((versionRange) =>
      this.versionService.satisfiesVersionRange(candidateVersion, versionRange)
    );
  }

  private resolveConstrainedUpdateCandidates(
    packageRowModels: PackageRowModel[],
    source: PackageSource,
    prerelease: boolean
  ): Observable<PackageRowModel[]> {
    const packagesNeedingHistory = packageRowModels.filter((packageRow) => {
      if (!packageRow.version) {
        return false;
      }
      const directPackages = this.getDirectInstalledPackagesForId(packageRow.id);
      return (
        directPackages.some((installedPackage) => this.getDeclaredVersionRanges(installedPackage).length > 0) &&
        !directPackages.some((installedPackage) => this.isVersionAllowedForInstalledPackage(installedPackage, packageRow.version))
      );
    });
    if (packagesNeedingHistory.length === 0) {
      return of(packageRowModels);
    }

    const packageIds = packagesNeedingHistory.map((packageRow) => packageRow.id);
    return this.nugetService.searchByPackageIds(packageIds, '', prerelease, source, true).pipe(
      map((historyRows) => {
        const historiesById = new Map(historyRows.map((packageRow) => [packageRow.id.toLowerCase(), packageRow]));
        return packageRowModels.map((packageRow) => {
          if (!packagesNeedingHistory.some((item) => item.id.toLowerCase() === packageRow.id.toLowerCase())) {
            return packageRow;
          }

          const history = historiesById.get(packageRow.id.toLowerCase());
          const directPackages = this.getDirectInstalledPackagesForId(packageRow.id);
          const allowedCandidate = history?.versions?.find((version) =>
            directPackages.some(
              (installedPackage) =>
                this.hasNewerVersion(installedPackage.version, version.version) &&
                this.isVersionAllowedForInstalledPackage(installedPackage, version.version)
            )
          );
          if (!history || !allowedCandidate) {
            return packageRow;
          }

          return {
            ...packageRow,
            version: allowedCandidate.version,
            description: allowedCandidate.description ?? packageRow.description,
            authors: allowedCandidate.authors,
            iconUrl: allowedCandidate.iconUrl ?? packageRow.iconUrl,
            vulnerabilities: allowedCandidate.vulnerabilities,
            deprecation: allowedCandidate.deprecation,
            versions: history.versions,
          };
        });
      })
    );
  }

  private hasDirectUpdate(packageRowModel: PackageRowModel): boolean {
    if (this._currentSolution.value) {
      return this._currentSolution.value.projects.some((project) =>
        this.isDirectOutdatedPackage(project.packages, packageRowModel)
      );
    }
    return this.isDirectOutdatedPackage(this._currentProject.value?.packages ?? [], packageRowModel);
  }

  private getConsolidatablePackageIds(): Set<string> {
    const solution = this._currentSolution.value;
    if (!solution) {
      return new Set();
    }

    const versionsByPackage = new Map<string, Map<string, Set<string>>>();
    solution.projects.forEach((project) => {
      project.packages.forEach((installedPackage) => {
        if (installedPackage.packageLevel === 'transitive') {
          return;
        }

        const id = installedPackage.id.toLowerCase();
        const frameworkVersions = installedPackage.targetFrameworkVersions?.filter(
          (item) => item.packageLevel !== 'transitive' && item.version.length > 0
        );
        const versions = new Set(
          frameworkVersions?.length
            ? frameworkVersions.map((item) => item.version)
            : installedPackage.targetFrameworkVersions?.length
              ? []
            : installedPackage.version && installedPackage.version !== 'Varies by target framework'
              ? [installedPackage.version]
              : []
        );
        if (versions.size === 0) {
          return;
        }

        const versionsByProject = versionsByPackage.get(id) ?? new Map<string, Set<string>>();
        const existingVersions = versionsByProject.get(project.fsPath) ?? new Set<string>();
        versions.forEach((version) => existingVersions.add(version));
        versionsByProject.set(project.fsPath, existingVersions);
        versionsByPackage.set(id, versionsByProject);
      });
    });

    const consolidatablePackageIds = new Set<string>();
    versionsByPackage.forEach((versionsByProject, id) => {
      if (versionsByProject.size < 2) {
        return;
      }
      const projectVersionSets = Array.from(versionsByProject.values()).map((versions) => JSON.stringify(Array.from(versions).sort()));
      if (new Set(projectVersionSets).size > 1) {
        consolidatablePackageIds.add(id);
      }
    });
    return consolidatablePackageIds;
  }

  private resetUnavailableConsolidateCategory(): void {
    if (this._currentCategory.value === Category.Consolidate && this.consolidationCount === 0) {
      this._currentCategory.next(Category.Installed);
    }
  }

  private refreshAvailableUpdateCount(): void {
    if (!this._currentSource || (!this._currentProject.value && !this._currentSolution.value)) {
      this.updateCountRequestSequence++;
      this.lastUpdateCountKey = undefined;
      this._availableUpdateCount.next({ count: null, loading: false });
      return;
    }

    const allInstalledPackages = this.getCurrentInstalledPackages();
    const key = this.getInstalledPackageDataKey(this._currentSource, this._currentPrerelease);
    if (key === this.lastUpdateCountKey && !this._availableUpdateCount.value.error) {
      return;
    }
    this.lastUpdateCountKey = key;

    const requestId = ++this.updateCountRequestSequence;
    const packageIds = Array.from(
      new Map(allInstalledPackages.map((item) => [item.id.toLowerCase(), item.id])).values()
    );
    if (packageIds.length === 0) {
      this._availableUpdateCount.next({ count: 0, loading: false });
      return;
    }

    const source = this._currentSource;
    const prerelease = this._currentPrerelease;
    this._availableUpdateCount.next({ count: null, loading: true });
    const isInitialMetadataLoad = this.initialPackageMetadataLoadPending;
    if (isInitialMetadataLoad) {
      this._contextLoading.next({ message: 'Loading installed package information from the selected source...' });
    }
    this.nugetService
      .searchByPackageIds(packageIds, '', prerelease, source, false)
      .pipe(switchMap((packages) => this.resolveConstrainedUpdateCandidates(packages, source, prerelease)))
      .subscribe({
      next: (packages) => {
        if (requestId !== this.updateCountRequestSequence) {
          return;
        }
        const updatedPackageIds = new Set(
          packages
            .filter((packageRow) => packageRow.version.length > 0 && this.hasDirectUpdate(packageRow))
            .map((packageRow) => packageRow.id.toLowerCase())
        );
        this._availableUpdateCount.next({ count: updatedPackageIds.size, loading: false });
        this.storeWarmedPackageInfo(source, prerelease, packages, updatedPackageIds.size);
        this.completeInitialPackageMetadataLoad(isInitialMetadataLoad);
      },
      error: () => {
        if (requestId !== this.updateCountRequestSequence) {
          return;
        }
        this._availableUpdateCount.next({
          count: null,
          loading: false,
          error: 'Could not load available updates from the selected source.',
        });
        this.completeInitialPackageMetadataLoad(isInitialMetadataLoad);
      },
      });
  }

  private completeInitialPackageMetadataLoad(isInitialMetadataLoad: boolean): void {
    if (!isInitialMetadataLoad) {
      return;
    }

    this.initialPackageMetadataLoadPending = false;
    this._contextLoading.next(null);
  }

  private updatePackageOperationProgress(): void {
    const messages = Array.from(this.packageOperationProgressMessages.values());
    this._packageOperationProgress.next(messages[messages.length - 1] ?? null);
  }
}
