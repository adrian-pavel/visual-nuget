import { Component, OnInit } from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { NUGET_ORG } from 'src/app/models/constants';
import { PackageSource } from 'src-common/models/package-source';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';

@Component({
  selector: 'app-tool-bar',
  templateUrl: './tool-bar.component.html',
  styleUrls: ['./tool-bar.component.scss'],
})
export class ToolBarComponent extends BaseComponent implements OnInit {
  public packageSources: PackageSource[] = [NUGET_ORG];

  public searchForm: FormGroup = this.fb.group({
    query: [''],
    prerelease: [false],
    source: [this.packageSources[0]],
  });

  constructor(private packageManager: PackageManagerService, private fb: FormBuilder) {
    super();
  }

  ngOnInit(): void {
    this.listenForFormChanges();
    this.listenForCategoryChanges();
    this.listenForSourcesChanges();
  }

  public refresh(): void {
    const query = this.getQueryValue();
    const prerelease = this.getPrereleaseValue();
    const source = this.getSourceValue();

    this.packageManager.queryForPackages(query, prerelease, source);
  }

  private listenForFormChanges(): void {
    this.subscriptions.add(this.searchForm.valueChanges.pipe(debounceTime(500)).subscribe(() => this.refresh()));
  }

  private listenForCategoryChanges() {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe(() => {
        this.refresh();
      })
    );
  }

  private listenForSourcesChanges(): void {
    this.subscriptions.add(
      this.packageManager.currentSources.subscribe((newSources) => {
        this.packageSources = [NUGET_ORG, ...newSources];
      })
    );
  }

  private getQueryValue(): string {
    return this.searchForm.get('query')?.value ?? '';
  }

  private getPrereleaseValue(): boolean {
    return this.searchForm.get('prerelease')?.value ?? false;
  }

  private getSourceValue(): PackageSource {
    return this.searchForm.get('source')?.value ?? this.packageSources[0];
  }
}
