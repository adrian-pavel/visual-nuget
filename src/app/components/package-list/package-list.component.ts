import { Component, OnInit } from '@angular/core';
import { PackageRowModel } from 'src/app/models/package-details';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-package-list',
  templateUrl: './package-list.component.html',
  styleUrls: ['./package-list.component.scss'],
})
export class PackageListComponent extends BaseComponent implements OnInit {
  public packages: PackageRowModel[] | null = null;

  public currentSelectedPackageId: string | null = null;

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentPackages();
    this.listenForCurrentSelectedPackage();
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
}
