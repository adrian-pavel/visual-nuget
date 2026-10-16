import { NgModule } from '@angular/core';
import { BrowserModule } from '@angular/platform-browser';

import { AppComponent } from './app.component';
import { NavBarComponent } from './components/nav-bar/nav-bar.component';
import { ToolBarComponent } from './components/tool-bar/tool-bar.component';
import { PackageRowComponent } from './components/package-row/package-row.component';
import { FontAwesomeModule, FaIconLibrary } from '@fortawesome/angular-fontawesome';
import { fas } from '@fortawesome/free-solid-svg-icons';
import { PackageListComponent } from './components/package-list/package-list.component';
import { PackageDetailsComponent } from './components/package-details/package-details.component';
import { provideHttpClient, withInterceptorsFromDi, withXhr } from '@angular/common/http';
import { ReactiveFormsModule } from '@angular/forms';
import { ShortNumberPipe } from './pipes/short-number.pipe';
import { LoadingSpinnerComponent } from './components/loading-spinner/loading-spinner.component';
import { PackageDetailsDependenciesComponent } from './components/package-details-dependencies/package-details-dependencies.component';
import { VersionRangePipe } from './pipes/version-range.pipe';
import { PackageDetailsVulnerabilitiesComponent } from './components/package-details-vulnerabilities/package-details-vulnerabilities.component';
import { SeverityPipe } from './pipes/severity.pipe';
import { AngularSplitModule } from 'angular-split';
import { SolutionProjectsComponent } from './components/solution-projects/solution-projects.component';
import { PackageOperationDialogComponent } from './components/package-operation-dialog/package-operation-dialog.component';

@NgModule({
  declarations: [
    AppComponent,
    NavBarComponent,
    ToolBarComponent,
    PackageRowComponent,
    PackageListComponent,
    PackageDetailsComponent,
    ShortNumberPipe,
    LoadingSpinnerComponent,
    PackageDetailsDependenciesComponent,
    VersionRangePipe,
    PackageDetailsVulnerabilitiesComponent,
    SeverityPipe,
    SolutionProjectsComponent,
    PackageOperationDialogComponent,
  ],
  bootstrap: [AppComponent],
  imports: [BrowserModule, ReactiveFormsModule, FontAwesomeModule, AngularSplitModule],
  providers: [provideHttpClient(withXhr(), withInterceptorsFromDi())],
})
export class AppModule {
  constructor(library: FaIconLibrary) {
    library.addIconPacks(fas);
  }
}
