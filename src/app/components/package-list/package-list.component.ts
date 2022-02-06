import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { PackageDetailsModel } from 'src/app/models/package-details';
import { PackageDetailsSearchResult } from 'src/app/models/search-results';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-package-list',
  templateUrl: './package-list.component.html',
  styleUrls: ['./package-list.component.scss'],
})
export class PackageListComponent implements OnInit, OnDestroy {
  public packages: PackageDetailsModel[] | null = null;

  public currentSelectedPackageId: string | undefined;

  private subscriptions: Subscription[] = [];

  constructor(private packageManager: PackageManagerService) {}

  ngOnInit(): void {
    this.listenForCurrentPackages();
    this.listenForCurrentSelectedPackage();
  }

  ngOnDestroy(): void {
    if (this.subscriptions) {
      for (const sub of this.subscriptions) {
        sub.unsubscribe();
      }
      this.subscriptions = [];
    }
  }

  private listenForCurrentPackages(): void {
    this.subscriptions.push(
      this.packageManager.currentPackages.subscribe((packages: PackageDetailsModel[] | null) => {
        this.packages = packages;
      })
    );
  }

  private listenForCurrentSelectedPackage() {
    this.subscriptions.push(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage: PackageDetailsSearchResult | null) => {
        this.currentSelectedPackageId = selectedPackage?.id;
      })
    );
  }
}
