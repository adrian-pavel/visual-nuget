import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { PackageRowModel } from 'src/app/models/package-details';
import { PackageSearchResult } from 'src/app/models/search-results';
import { PackageManagerService } from 'src/app/services/package-manager.service';

@Component({
  selector: 'app-package-list',
  templateUrl: './package-list.component.html',
  styleUrls: ['./package-list.component.scss'],
})
export class PackageListComponent implements OnInit, OnDestroy {
  public packages: PackageRowModel[] | null = null;

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
      this.packageManager.currentPackages.subscribe((packages: PackageRowModel[] | null) => {
        this.packages = packages;
      })
    );
  }

  private listenForCurrentSelectedPackage() {
    this.subscriptions.push(
      this.packageManager.currentSelectedPackage.subscribe((selectedPackage: PackageSearchResult | null) => {
        this.currentSelectedPackageId = selectedPackage?.id;
      })
    );
  }
}
