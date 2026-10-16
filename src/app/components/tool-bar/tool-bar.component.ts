import { Component, OnInit, ChangeDetectionStrategy } from '@angular/core';
import { UntypedFormBuilder, UntypedFormGroup } from '@angular/forms';
import { debounceTime } from 'rxjs/operators';
import { Category } from 'src/app/models/category';
import { NUGET_ORG } from 'src/app/models/constants';
import { PackageSource } from 'src-common/models/package-source';
import { PackageManagerService } from 'src/app/services/package-manager.service';

import { BaseComponent } from '../base-component';
import { VscodeService } from 'src/app/services/vscode.service';

@Component({
    selector: 'app-tool-bar',
    templateUrl: './tool-bar.component.html',
    styleUrls: ['./tool-bar.component.scss'],
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class ToolBarComponent extends BaseComponent implements OnInit {
  public packageSources: PackageSource[] = [];

  public searchForm: UntypedFormGroup | undefined;
  private currentCategory = Category.Browse;

  constructor(private packageManager: PackageManagerService, private fb: UntypedFormBuilder, private vscodeService: VscodeService) {
    super();
  }

  ngOnInit(): void {
    this.listenForSourcesChanges();
    this.listenForProjectChanges();
  }

  public refresh(forceRefresh = true, refreshFeed = false): void {
    const query = this.getQueryValue();
    const prerelease = this.getPrereleaseValue();
    const source = this.getSourceValue();

    this.packageManager.queryForPackages(query, prerelease, source, forceRefresh, refreshFeed);
  }

  public openSettings(): void {
    this.vscodeService.postMessage({ command: 'open-settings' });
  }

  private listenForSourcesChanges(): void {
    this.subscriptions.add(
      this.packageManager.currentSources.subscribe((newSources) => {
        if (newSources.length <= 0) {
          this.packageSources = [NUGET_ORG];
        } else {
          this.packageSources = [...newSources];
        }

        this.initForm();
      })
    );
  }

  private listenForProjectChanges(): void {
    this.subscriptions.add(
      this.packageManager.currentProject.subscribe((project) => {
        if (project && this.searchForm && this.currentCategory !== Category.Browse) {
          this.refresh();
        }
      })
    );
    this.subscriptions.add(
      this.packageManager.currentSolution.subscribe((solution) => {
        if (solution && this.searchForm && this.currentCategory !== Category.Browse) {
          this.refresh();
        }
      })
    );
  }

  private initForm(): void {
    this.searchForm = this.fb.group({
      query: [''],
      prerelease: [false],
      source: [this.packageSources[0]],
    });

    this.listenForFormChanges();
    this.listenForCategoryChanges();
  }

  private listenForFormChanges(): void {
    if (!this.searchForm) {
      throw Error('Search form not initialized');
    }
    this.subscriptions.add(this.searchForm.valueChanges.pipe(debounceTime(500)).subscribe(() => this.refresh()));
  }

  private listenForCategoryChanges(): void {
    this.subscriptions.add(
      this.packageManager.currentCategory.subscribe((category) => {
        this.currentCategory = category;
        this.refresh(false);
      })
    );
  }

  private getQueryValue(): string {
    return this.searchForm?.get('query')?.value ?? '';
  }

  private getPrereleaseValue(): boolean {
    return this.searchForm?.get('prerelease')?.value ?? false;
  }

  private getSourceValue(): PackageSource {
    return this.searchForm?.get('source')?.value ?? this.packageSources[0];
  }
}
