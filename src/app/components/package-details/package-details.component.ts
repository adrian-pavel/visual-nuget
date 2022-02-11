import { Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PackageRowModel } from 'src/app/models/package-details';
import { CatalogEntry } from 'src/app/models/package-meta';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-package-details',
  templateUrl: './package-details.component.html',
  styleUrls: ['./package-details.component.scss'],
})
export class PackageDetailsComponent implements OnInit {
  public package: PackageRowModel | null = null;

  public selectedVersion: FormControl = new FormControl();

  public get selectedVersionObject(): CatalogEntry {
    return this.selectedVersion.value as CatalogEntry;
  }

  private subscriptions: Subscription[] = [];

  constructor(private packageManager: PackageManagerService) {}

  ngOnInit(): void {
    this.listenForCurrentPackage();
  }

  ngOnDestroy(): void {
    if (this.subscriptions) {
      for (const sub of this.subscriptions) {
        sub.unsubscribe();
      }
      this.subscriptions = [];
    }
  }

  public install(): void {
    this.packageManager.installPackage(this.package, this.selectedVersionObject.version);
  }

  public uninstall(): void {
    this.packageManager.uninstallPackage(this.package);
  }

  private listenForCurrentPackage(): void {
    this.subscriptions.push(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage) => {
        console.log('Current Package: ', selectedPackage);
        this.package = selectedPackage;
        if (this.package) {
          // we will make sure to load versions before getting here
          this.selectedVersion.setValue(this.package.versions![0]);
        }
      })
    );
  }
}
