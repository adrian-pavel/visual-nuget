import { Component, OnInit } from '@angular/core';
import { FormControl } from '@angular/forms';
import { Subscription } from 'rxjs';
import { PackageDetailsModel } from 'src/app/models/package-details';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-package-details',
  templateUrl: './package-details.component.html',
  styleUrls: ['./package-details.component.scss'],
})
export class PackageDetailsComponent implements OnInit {
  public package: PackageDetailsModel | null = null;

  public selectedVersion: FormControl = new FormControl();

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
    this.packageManager.installPackage(this.package, this.selectedVersion.value);
  }

  public uninstall(): void {
    this.packageManager.uninstallPackage(this.package);
  }

  private listenForCurrentPackage(): void {
    this.subscriptions.push(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage) => {
        if (!selectedPackage) {
          this.package = null;
        }
        this.package = selectedPackage;
        if (this.package) {
          this.selectedVersion.setValue(this.package.versions[0].version);
        }
      })
    );
  }
}
