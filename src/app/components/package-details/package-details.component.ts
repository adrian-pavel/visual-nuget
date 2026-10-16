import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { PackageRowModel } from '../../models/package-row-model';
import { CatalogEntry, PackageDeprecation, Vulnerability } from '../../models/package-meta';
import { PackageManagerService } from '../../services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
    selector: 'app-package-details',
    templateUrl: './package-details.component.html',
    styleUrls: ['./package-details.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class PackageDetailsComponent extends BaseComponent implements OnInit {
  public package: PackageRowModel | null = null;
  public isSolution = false;
  public selectedProjectPaths: string[] = [];
  public includeCpmExceptions = false;
  public loadError: string | null = null;

  public selectedVersion: UntypedFormControl = new UntypedFormControl();
  private selectedPackageId: string | null = null;

  public get selectedVersionObject(): CatalogEntry {
    return this.selectedVersion.value as CatalogEntry;
  }

  public versionOptionLabel(version: CatalogEntry): string {
    const warnings: string[] = [];
    if (version.vulnerabilities?.length) {
      warnings.push('Vulnerable');
    }
    if (version.deprecation) {
      warnings.push('Deprecated');
    }
    return warnings.length > 0 ? `${version.version} ⚠️ ${warnings.join(', ')}` : version.version;
  }

  public get selectedVersionVulnerabilities(): Vulnerability[] | undefined {
    const selectedVersion = this.selectedVersion.value as CatalogEntry | undefined;
    if (selectedVersion?.vulnerabilities !== undefined) {
      return selectedVersion.vulnerabilities;
    }
    if (this.package && selectedVersion?.version === this.package.version) {
      return this.package.vulnerabilities;
    }
    return undefined;
  }

  public get selectedVersionDeprecation(): PackageDeprecation | undefined {
    const selectedVersion = this.selectedVersion.value as CatalogEntry | undefined;
    if (selectedVersion?.deprecation !== undefined) {
      return selectedVersion.deprecation;
    }
    if (this.package && selectedVersion?.version === this.package.version) {
      return this.package.deprecation;
    }
    return undefined;
  }

  public get isLoading(): boolean {
    return this.selectedPackageId !== null && this.package === null && this.loadError === null;
  }

  public get isPackageOperationInProgress(): boolean {
    return this.packageManager.isPackageOperationInProgress;
  }

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentPackage();
    this.subscriptions.add(
      this.packageManager.currentSelectedPackageId.subscribe((selectedPackageId) => {
        this.selectedPackageId = selectedPackageId;
      })
    );
    this.subscriptions.add(
      this.packageManager.currentSelectedPackageError.subscribe((error) => {
        this.loadError = error;
      })
    );
    this.subscriptions.add(
      this.packageManager.currentSolution.subscribe((solution) => {
        this.isSolution = solution !== null;
        this.selectedProjectPaths = this.package ? this.packageManager.selectedProjectsForPackage(this.package.id) : [];
      })
    );
  }

  public install(): void {
    if (this.isSolution) {
      this.packageManager.installPackage(this.package, this.selectedVersionObject.version, this.selectedProjectPaths, this.includeCpmExceptions);
      return;
    }
    this.packageManager.installPackage(this.package, this.selectedVersionObject.version);
  }

  public uninstall(): void {
    this.packageManager.uninstallPackage(this.package, this.selectedProjectPaths);
  }

  public get allProjectsSelected(): boolean {
    return !!this.package?.solutionProjectStates?.length && this.selectedProjectPaths.length === this.package.solutionProjectStates.length;
  }

  public get hasCpmExceptions(): boolean {
    return (
      this.package?.solutionProjectStates?.some(
        state =>
          this.selectedProjectPaths.includes(state.projectPath) &&
          state.isInstalled &&
          (state.versionSource === 'override' ||
            new Set(state.targetFrameworkVersions?.map((item) => item.version) ?? []).size > 1 ||
            state.targetFrameworkVersions?.some((item) => item.condition !== undefined))
      ) ?? false
    );
  }

  public get hasSelectedCentralVersion(): boolean {
    return (
      this.package?.solutionProjectStates?.some(
        (state) =>
          this.selectedProjectPaths.includes(state.projectPath) &&
          state.managePackageVersionsCentrally &&
          state.versionSource === 'central'
      ) ?? false
    );
  }

  public get hasSelectedDirectPackage(): boolean {
    return (
      this.package?.solutionProjectStates?.some(
        (state) => this.selectedProjectPaths.includes(state.projectPath) && state.isDirectlyInstalled
      ) ?? false
    );
  }

  public get hasDirectInstalledPackage(): boolean {
    return this.package?.solutionProjectStates?.some((state) => state.isDirectlyInstalled) ?? false;
  }

  public get installButtonLabel(): string {
    return this.hasSelectedDirectPackage ? 'Update' : 'Install';
  }

  public toggleProject(projectPath: string, selected: boolean): void {
    const projectPaths = new Set(this.selectedProjectPaths);
    if (selected) {
      projectPaths.add(projectPath);
    } else {
      projectPaths.delete(projectPath);
    }
    this.setSelectedProjects(Array.from(projectPaths));
  }

  public toggleAllProjects(selected: boolean): void {
    this.setSelectedProjects(selected ? this.package?.solutionProjectStates?.map((state) => state.projectPath) ?? [] : []);
  }

  public trackProject(projectPath: string): string {
    return projectPath;
  }

  private listenForCurrentPackage(): void {
    this.subscriptions.add(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage: PackageRowModel | null) => {
        this.package = selectedPackage;
        if (this.package) {
          // we will make sure to load versions before getting here
          this.selectedVersion.setValue(this.package.versions?.[0]);
          this.selectedProjectPaths = this.isSolution ? this.packageManager.selectedProjectsForPackage(this.package.id) : [];
          this.includeCpmExceptions = false;
        } else {
          this.selectedProjectPaths = [];
        }
      })
    );
  }

  private setSelectedProjects(projectPaths: string[]): void {
    if (!this.package) {
      return;
    }
    this.selectedProjectPaths = projectPaths;
    this.packageManager.selectProjectsForPackage(this.package.id, projectPaths);
  }
}
