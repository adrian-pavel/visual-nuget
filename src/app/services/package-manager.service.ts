import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

import { Category } from '../models/category';
import { PackageRowModel } from '../models/package-row-model';
import { NUGET_ORG, PackageSource } from '../models/package-source';
import { InstalledPackage, Project } from '../models/project';
import { InstallMessage, UninstallMessage } from '../models/ui-message';
import { NuGetApiService } from './nuget-api.service';
import { VscodeService } from './vscode.service';

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

  private _currentPackages = new BehaviorSubject<PackageRowModel[] | null>(null);
  public get currentPackages(): Observable<PackageRowModel[] | null> {
    return this._currentPackages.asObservable();
  }

  private _currentSelectedPackage = new BehaviorSubject<PackageRowModel | null>(null);
  public get currentSelectedPackage(): Observable<PackageRowModel | null> {
    return this._currentSelectedPackage.asObservable();
  }

  private _currentSelectedPackageId = new BehaviorSubject<string | null>(null);
  public get currentSelectedPackageId(): Observable<string | null> {
    return this._currentSelectedPackageId.asObservable();
  }

  private _currentSource: PackageSource = NUGET_ORG;
  private _currentPrerelease = false;

  constructor(private nugetService: NuGetApiService, private vscodeService: VscodeService) {
    // tell the extension to load the project and it's installed packages
    // now we are sure the UI is loaded and ready to receive the message
    vscodeService.postMessage({
      command: 'load-project',
    });
  }

  public queryForPackages(query: string, prerelease: boolean, source: PackageSource): void {
    this._currentSelectedPackage.next(null);
    this._currentSelectedPackageId.next(null);
    this._currentPackages.next(null);

    this._currentSource = source;
    this._currentPrerelease = prerelease;

    const currentCategory = this._currentCategory.value;

    if (currentCategory === Category.Browse) {
      this.nugetService.search(query, prerelease, source).subscribe((packageRowModels: PackageRowModel[]) => {
        this.setInstalledInformation(packageRowModels);
        this._currentPackages.next(packageRowModels);
      });
    } else {
      const currentInstalledPackageIds = this.getCurrentInstalledPackageIds();
      if (currentInstalledPackageIds.length) {
        this.nugetService
          .searchByPackageIds(currentInstalledPackageIds, query, prerelease, source)
          .subscribe((packageRowModels: PackageRowModel[]) => {
            this.setInstalledInformation(packageRowModels);
            packageRowModels = this.filterResultsToMatchCategory(packageRowModels);
            this._currentPackages.next(packageRowModels);
          });
      } else {
        this._currentPackages.next([]);
      }
    }
  }

  public changeCurrentProject(project: Project) {
    this._currentProject.next(project);

    const currentPackages = this._currentPackages.value;
    if (currentPackages && project.packages.length) {
      this.setInstalledInformation(currentPackages);
    }
  }

  public changeCurrentSources(sources: PackageSource[]): void {
    this._currentSources.next(sources);
  }

  public changeCurrentSelectedPackage(selectedPackage: PackageRowModel | null): void {
    // set the current selected package id so that the list highlights it
    this._currentSelectedPackageId.next(selectedPackage?.id ?? null);
    // set the current selected package to null to clear the details pane
    this._currentSelectedPackage.next(null);

    // if no package selected or if the versions/metadata for the package are already loaded, just display it
    if (selectedPackage == null || selectedPackage.versions !== undefined) {
      this._currentSelectedPackage.next(selectedPackage);
    } else {
      // else query the api for the package metadata and use the versions from the result
      this.nugetService.searchByPackageIds([selectedPackage?.id], '', this._currentPrerelease, this._currentSource).subscribe((results) => {
        selectedPackage.versions = results[0].versions;
        this._currentSelectedPackage.next(selectedPackage);
      });
    }
  }

  public changeCurrentCategory(category: Category): void {
    this._currentCategory.next(category);
  }

  public installPackage(packageToInstall: PackageRowModel | null, version?: string) {
    if (packageToInstall === null) {
      return;
    }

    const installMessage = this.mapPackageToInstallMessage(packageToInstall, version);

    this.vscodeService.postMessage(installMessage);
  }

  public installPackages(packagesToInstall: PackageRowModel[]) {
    if (packagesToInstall.length <= 0) {
      return;
    }

    const installMessages = packagesToInstall.map((p) => this.mapPackageToInstallMessage(p));

    this.vscodeService.postMessages(installMessages);
  }

  public uninstallPackage(packageToUninstall: PackageRowModel | null) {
    if (packageToUninstall === null) {
      return;
    }

    this.vscodeService.postMessage({
      command: 'remove-package',
      projectName: this._currentProject.value?.fsPath,
      packageId: packageToUninstall.id,
    } as UninstallMessage);
  }

  private mapPackageToInstallMessage(packageToInstall: PackageRowModel, version?: string): InstallMessage {
    const currentProject = this._currentProject.value;
    if (!currentProject) {
      throw new Error('Current project cannot be undefined');
    }

    // if no specific version is provided just install the latest on the package
    const versionToInstall = version ?? packageToInstall.version;

    return {
      command: 'add-package',
      projectName: currentProject.fsPath,
      packageId: packageToInstall.id,
      packageVersion: versionToInstall,
      packageSourceUrl: packageToInstall.sourceUrl,
    };
  }

  private setInstalledInformation(packageRowModels: PackageRowModel[]): void {
    const currentInstalledPackages = this._currentProject.value?.packages;

    if (currentInstalledPackages) {
      packageRowModels.forEach((packageRowModel: PackageRowModel) => {
        const installedPackage = currentInstalledPackages.find((installedPackage: InstalledPackage) => installedPackage.id === packageRowModel.id);

        packageRowModel.isInstalled = installedPackage !== undefined;
        packageRowModel.installedVersion = installedPackage ? installedPackage.version : '';
        packageRowModel.isOutdated = packageRowModel.isInstalled && packageRowModel.installedVersion !== packageRowModel.version;
      });
    }
  }

  private filterResultsToMatchCategory(packageRowModels: PackageRowModel[]): PackageRowModel[] {
    const currentCategory = this._currentCategory.value;

    if (currentCategory === Category.Updates) {
      return packageRowModels.filter((packageRowModel: PackageRowModel) => packageRowModel.isOutdated);
    }

    return packageRowModels;
  }

  private getCurrentInstalledPackageIds(): string[] {
    const currentInstalledPackages = this._currentProject.value?.packages;

    if (!currentInstalledPackages) {
      return [];
    }

    return currentInstalledPackages.map((installedPackage: InstalledPackage) => installedPackage.id);
  }
}
