import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { Category } from '../../models/category';
import { PackageRowModel } from '../../models/package-row-model';
import { ContextLoadingState, PackageManagerService } from '../../services/package-manager.service';
import { SelectionService } from '../../services/selection.service';

import { BaseComponent } from '../base-component';

@Component({
    selector: 'app-package-list',
    templateUrl: './package-list.component.html',
    styleUrls: ['./package-list.component.scss'],
    providers: [SelectionService],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class PackageListComponent extends BaseComponent implements OnInit {
  private currentSelectedCategory: Category = Category.Browse;

  public packages: PackageRowModel[] | null = null;
  public loadError: string | null = null;
  public contextLoading: ContextLoadingState | null = null;
  public isSolution = false;
  public buildAfterRestore = false;

  public currentSelectedPackageId: string | null = null;

  public get showSelectCheckboxes(): boolean {
    return this.currentSelectedCategory === Category.Updates && this.packages !== null && this.packages.length > 0;
  }

  public get showTransitivePackages(): boolean {
    return this.currentSelectedCategory === Category.Installed;
  }

  public get isPackageOperationInProgress(): boolean {
    return this.packageManager.isPackageOperationInProgress;
  }

  public get topLevelPackages(): PackageRowModel[] {
    return (this.packages ?? []).filter((packageRow) => !this.isTransitivePackage(packageRow));
  }

  public get transitivePackages(): PackageRowModel[] {
    return (this.packages ?? []).filter((packageRow) => this.isTransitivePackage(packageRow));
  }

  public get areAllSelected(): boolean {
    if (this.packages === null) {
      return false;
    }
    return this.selectionService.areAllSelected(this.packages);
  }

  constructor(private packageManager: PackageManagerService, public selectionService: SelectionService<PackageRowModel>) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentPackages();
    this.listenForCurrentSelectedPackage();
    this.listenForSelectedCategory();
    this.subscriptions.add(
      this.packageManager.currentPackagesError.subscribe((error) => {
        this.loadError = error;
      })
    );
    this.subscriptions.add(
      this.packageManager.contextLoading.subscribe((state) => {
        this.contextLoading = state;
      })
    );
    this.subscriptions.add(
      this.packageManager.currentSolution.subscribe((solution) => {
        this.isSolution = solution !== null;
      })
    );
  }

  public selectAll(event: MouseEvent): void {
    const isSelected = (event.target as HTMLInputElement).checked;
    if (isSelected) {
      if (this.packages !== null) {
        this.selectionService.selectAll(this.packages);
      }
    } else {
      this.selectionService.clear();
    }
  }

  public rowSelectChange(packageRow: PackageRowModel, isSelected: boolean): void {
    if (isSelected) {
      this.selectionService.select(packageRow);
    } else {
      this.selectionService.deselect(packageRow);
    }
  }

  public updateSelected(): void {
    this.packageManager.installPackages(this.selectionService.selected, this.buildAfterRestore);
    this.selectionService.clear();
  }

  public onBuildAfterRestoreChange(event: Event): void {
    this.buildAfterRestore = (event.target as HTMLInputElement).checked;
  }

  private isTransitivePackage(packageRow: PackageRowModel): boolean {
    const installedProjects = packageRow.solutionProjectStates?.filter((state) => state.isInstalled);
    if (installedProjects) {
      return installedProjects.length > 0 && installedProjects.every((state) => state.packageLevel === 'transitive');
    }
    return packageRow.packageLevel === 'transitive';
  }

  private listenForCurrentPackages(): void {
    this.subscriptions.add(
      this.packageManager.currentPackages.subscribe((packages: PackageRowModel[] | null) => {
        this.selectionService.clear();
        this.packages = packages;
      })
    );
  }

  private listenForCurrentSelectedPackage() {
    this.subscriptions.add(
      this.packageManager.currentSelectedPackageId.subscribe((selectedPackageId: string | null) => {
        this.currentSelectedPackageId = selectedPackageId;
      })
    );
  }

  private listenForSelectedCategory() {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((selectedCategory: Category) => {
        this.currentSelectedCategory = selectedCategory;
      })
    );
  }
}
