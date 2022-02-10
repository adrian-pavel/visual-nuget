import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { Category } from '../models/category';
import { PackageDetailsModel } from '../models/package-details';
import { PackageSource } from '../models/package-source';
import { Package, Project } from '../models/project';
import { PackageDetailsSearchResult, SearchResults } from '../models/search-results';
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

  private _currentPackages = new BehaviorSubject<PackageDetailsModel[] | null>(null);
  public get currentPackages(): Observable<PackageDetailsModel[] | null> {
    return this._currentPackages.asObservable();
  }

  private _currentInstalledPackages = new BehaviorSubject<Package[] | null>(null);
  public get currentInstalledPackages(): Observable<Package[] | null> {
    return this._currentInstalledPackages.asObservable();
  }

  private _currentSelectedPackage = new BehaviorSubject<PackageDetailsModel | null>(null);
  public get currentSelectedPackage(): Observable<PackageDetailsModel | null> {
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
      this.nugetService.search(query, prerelease, source).subscribe((results: SearchResults) => {
        let packageDetailModels = this.mapSearchResultsToPackageDetails(results.data, source);
        this.setInstalledInformation(packageDetailModels);
        this._currentPackages.next(packageDetailModels);
      });
    } else {
      const currentInstalledPackageIds = this.getCurrentInstalledPackageIds();
      this.nugetService.searchByPackageIds(currentInstalledPackageIds, query, source).subscribe((results: SearchResults) => {
        let packageDetailModels = this.mapSearchResultsToPackageDetails(results.data, source);
        this.setInstalledInformation(packageDetailModels);
        packageDetailModels = this.filterResultsToMatchCategory(packageDetailModels);

        this._currentPackages.next(packageDetailModels);
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

  public changeCurrentSelectedPackage(selectedPackage: PackageDetailsModel | null): void {
    this._currentSelectedPackage.next(selectedPackage);
  }

  public changeCurrentCategory(category: Category): void {
    this._currentCategory.next(category);
  }

  public installPackage(packageToInstall: PackageDetailsModel | null, version?: string) {
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

  public uninstallPackage(packageToUninstall: PackageDetailsModel | null) {
    if (packageToUninstall === null) {
      return;
    }

    vscode.postMessage({
      command: 'remove-package',
      projectName: this._currentProjectName.value,
      packageId: packageToUninstall.id,
    });
  }

  private mapSearchResultsToPackageDetails(packageSearchResults: PackageDetailsSearchResult[], source: PackageSource): PackageDetailsModel[] {
    const packagesWithInstalledInfo = packageSearchResults.map((psr) => {
      const pdm = {
        ...psr,
        isInstalled: false,
        installedVersion: '',
        isOutdated: false,
        sourceUrl: source.url,
      };
      return pdm as PackageDetailsModel;
    });

    return packagesWithInstalledInfo;
  }

  private setInstalledInformation(packageDetailModels: PackageDetailsModel[]): void {
    const currentInstalledPackages = this._currentInstalledPackages.value;

    packageDetailModels.forEach((pdm) => {
      const installedPackage = currentInstalledPackages?.find((p) => p.id === pdm.id);

      pdm.isInstalled = installedPackage !== undefined;
      pdm.installedVersion = pdm.isInstalled ? installedPackage!.version : '';
      pdm.isOutdated = pdm.isInstalled && pdm.installedVersion !== pdm.version;
    });
  }

  private filterResultsToMatchCategory(packageDetailModels: PackageDetailsModel[]): PackageDetailsModel[] {
    const currentCategory = this._currentCategory.value;
    if (currentCategory === Category.Updates) {
      return packageDetailModels.filter((pdm) => pdm.isOutdated);
    }

    return packageDetailModels;
  }

  private getCurrentInstalledPackageIds(): string[] {
    const currentInstalledPackages = this._currentInstalledPackages.value;

    if (!currentInstalledPackages) {
      return [];
    }

    return currentInstalledPackages.map((ip) => ip.id);
  }
}
