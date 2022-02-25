import { Component, OnInit } from '@angular/core';
import { Category } from 'src/app/models/category';
import { PackageRowModel } from 'src/app/models/package-row-model';
import { PackageManagerService } from 'src/app/services/package-manager.service';
import { SelectionService } from 'src/app/services/selection.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-package-list',
  templateUrl: './package-list.component.html',
  styleUrls: ['./package-list.component.scss'],
  providers: [SelectionService],
})
export class PackageListComponent extends BaseComponent implements OnInit {
  private currentSelectedCategory: Category = Category.Browse;

  public packages: PackageRowModel[] | null = null;

  public currentSelectedPackageId: string | null = null;

  public get showSelectCheckboxes(): boolean {
    return this.currentSelectedCategory === Category.Updates && this.packages !== null && this.packages.length > 0;
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
    isSelected ? this.selectionService.select(packageRow) : this.selectionService.deselect(packageRow);
  }

  public updateSelected(): void {
    this.packageManager.installPackages(this.selectionService.selected);
    this.selectionService.clear();
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
