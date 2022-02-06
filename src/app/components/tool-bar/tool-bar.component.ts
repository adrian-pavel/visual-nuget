import { Component, OnInit } from '@angular/core';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { FormBuilder, FormControl, FormGroup } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { PackageSource } from 'src/app/models/package-source';

@Component({
  selector: 'app-tool-bar',
  templateUrl: './tool-bar.component.html',
  styleUrls: ['./tool-bar.component.scss'],
})
export class ToolBarComponent implements OnInit {
  private readonly nugetOrg: PackageSource = {
    name: 'nuget.org',
    url: 'https://api.nuget.org/v3/index.json',
    authorizationHeader: undefined,
  };

  public packageSources: PackageSource[] = [this.nugetOrg];

  public searchForm: FormGroup = this.fb.group({
    query: [''],
    prerelease: [false],
    source: [this.packageSources[0]],
  });

  constructor(private packageManager: PackageManagerService, private fb: FormBuilder) {}

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

  private listenForSourcesChanges(): void {
    this.packageManager.currentSources.subscribe((newSources) => {
      this.packageSources = [this.nugetOrg, ...newSources];
    });
  }

  private listenForFormChanges(): void {
    this.searchForm.valueChanges.pipe(debounceTime(500)).subscribe((_) => this.refresh());
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

  private listenForCategoryChanges() {
    this.packageManager.currentCategory.subscribe(() => {
      this.refresh();
    });
  }
}
