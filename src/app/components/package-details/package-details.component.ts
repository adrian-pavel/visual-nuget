import { Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { PackageRowModel } from 'src/app/models/package-row-model';
import { CatalogEntry } from 'src/app/models/package-meta';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-package-details',
  templateUrl: './package-details.component.html',
  styleUrls: ['./package-details.component.scss'],
})
export class PackageDetailsComponent extends BaseComponent implements OnInit {
  public package: PackageRowModel | null = null;

  public selectedVersion: FormControl = new FormControl();

  public get selectedVersionObject(): CatalogEntry {
    return this.selectedVersion.value as CatalogEntry;
  }

  constructor(private packageManager: PackageManagerService) {
    super();
  }

  ngOnInit(): void {
    this.listenForCurrentPackage();
  }

  public install(): void {
    this.packageManager.installPackage(this.package, this.selectedVersionObject.version);
  }

  public uninstall(): void {
    this.packageManager.uninstallPackage(this.package);
  }

  private listenForCurrentPackage(): void {
    this.subscriptions.add(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage: PackageRowModel | null) => {
        this.package = selectedPackage;
        if (this.package) {
          // we will make sure to load versions before getting here
          this.selectedVersion.setValue(this.package.versions![0]);
        }
      })
    );
  }
}
