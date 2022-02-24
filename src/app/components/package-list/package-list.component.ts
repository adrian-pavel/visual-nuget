import { Component, OnInit } from '@angular/core';
import { Category } from 'src/app/models/category';
import { PackageRowModel } from 'src/app/models/package-row-model';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-package-list',
  templateUrl: './package-list.component.html',
  styleUrls: ['./package-list.component.scss'],
})
export class PackageListComponent extends BaseComponent implements OnInit {
  private currentSelectedCategory: Category = Category.Browse;

  public packages: PackageRowModel[] | null = null;

  public currentSelectedPackageId: string | null = null;

  public get showSelectCheckboxes(): boolean {
    return this.currentSelectedCategory === Category.Updates && this.packages !== null && this.packages.length > 0;
  }

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentPackages();
    this.listenForCurrentSelectedPackage();
    this.listenForSelectedCategory();
  }

  public updateSelected(): void {
    this.packageManager.installPackages([]);
  }

  private listenForCurrentPackages(): void {
    this.subscriptions.add(
      this.packageManager.currentPackages.subscribe((packages: PackageRowModel[] | null) => {
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
