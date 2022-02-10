import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Category } from '../models/category';
import { PackageRowModel } from '../models/package-details';
import { PackageSource } from '../models/package-source';
import { Package, Project } from '../models/project';
import { PackageSearchResult, SearchResults } from '../models/search-results';
import { NuGetApiService } from './nuget-api.service';

declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();

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

  private _currentProjectName = new BehaviorSubject<string>('');
  public get currentProjectName(): Observable<string> {
    return this._currentProjectName.asObservable();
  }

  private _currentPackages = new BehaviorSubject<PackageRowModel[] | null>(null);
  public get currentPackages(): Observable<PackageRowModel[] | null> {
    return this._currentPackages.asObservable();
  }

  private _currentInstalledPackages = new BehaviorSubject<Package[] | null>(null);
  public get currentInstalledPackages(): Observable<Package[] | null> {
    return this._currentInstalledPackages.asObservable();
  }

  private _currentSelectedPackage = new BehaviorSubject<PackageRowModel | null>(null);
  public get currentSelectedPackage(): Observable<PackageRowModel | null> {
    return this._currentSelectedPackage.asObservable();
  }

  constructor(private nugetService: NuGetApiService) {
    // tell the extension to load the project and it's installed packages
    // now we are sure the UI is loaded and ready to receive the message
    vscode.postMessage({
      command: 'load-project',
    });
  }

  public queryForPackages(query: string, prerelease: boolean, source: PackageSource): void {
    this._currentSelectedPackage.next(null);
    this._currentPackages.next(null);

    const currentCategory = this._currentCategory.value;

    if (currentCategory === Category.Browse) {
      this.nugetService.search(query, prerelease, source).subscribe((packageRowModels: PackageRowModel[]) => {
        this.setInstalledInformation(packageRowModels);
        this._currentPackages.next(packageRowModels);
      });
    } else {
      const currentInstalledPackageIds = this.getCurrentInstalledPackageIds();
      this.nugetService.searchByPackageIds(currentInstalledPackageIds, query, prerelease, source).subscribe((packageRowModels: PackageRowModel[]) => {
        this.setInstalledInformation(packageRowModels);
        packageRowModels = this.filterResultsToMatchCategory(packageRowModels);
        console.log(packageRowModels);
        this._currentPackages.next(packageRowModels);
      });
    }
  }

  public setProject(project: Project) {
    this._currentProjectName.next(project.name);
    this._currentInstalledPackages.next(project.packages);

    const currentPackages = this._currentPackages.value;
    if (currentPackages) {
      this.setInstalledInformation(currentPackages);
    }
  }

  public setSources(sources: PackageSource[]): void {
    this._currentSources.next(sources);
  }

  public changeCurrentSelectedPackage(selectedPackage: PackageRowModel | null): void {
    this._currentSelectedPackage.next(selectedPackage);
  }

  public changeCurrentCategory(category: Category): void {
    this._currentCategory.next(category);
  }

  public installPackage(packageToInstall: PackageRowModel | null, version?: string) {
    if (packageToInstall === null) {
      return;
    }

    const versionToInstall = version ? version : packageToInstall.version;

    vscode.postMessage({
      command: 'add-package',
      projectName: this._currentProjectName.value,
      packageId: packageToInstall.id,
      packageVersion: versionToInstall,
      packageSourceUrl: packageToInstall.sourceUrl,
    });
  }

  public uninstallPackage(packageToUninstall: PackageRowModel | null) {
    if (packageToUninstall === null) {
      return;
    }

    vscode.postMessage({
      command: 'remove-package',
      projectName: this._currentProjectName.value,
      packageId: packageToUninstall.id,
    });
  }

  private setInstalledInformation(packageRowModels: PackageRowModel[]): void {
    const currentInstalledPackages = this._currentInstalledPackages.value;

    packageRowModels.forEach((pdm) => {
      const installedPackage = currentInstalledPackages?.find((p) => p.id === pdm.id);

      pdm.isInstalled = installedPackage !== undefined;
      pdm.installedVersion = pdm.isInstalled ? installedPackage!.version : '';
      pdm.isOutdated = pdm.isInstalled && pdm.installedVersion !== pdm.version;
    });
  }

  private filterResultsToMatchCategory(packageRowModels: PackageRowModel[]): PackageRowModel[] {
    const currentCategory = this._currentCategory.value;
    if (currentCategory === Category.Updates) {
      return packageRowModels.filter((pdm) => pdm.isOutdated);
    }

    return packageRowModels;
  }

  private getCurrentInstalledPackageIds(): string[] {
    const currentInstalledPackages = this._currentInstalledPackages.value;

    if (!currentInstalledPackages) {
      return [];
    }

    return currentInstalledPackages.map((ip) => ip.id);
  }
}
