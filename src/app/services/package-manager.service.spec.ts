import { TestBed } from '@angular/core/testing';
import { of, skip, take, zip } from 'rxjs';
import { Category } from '../models/category';
import { PackageRowModel } from '../models/package-row-model';
import { PackageSource } from '../../../src-common/models/package-source';
import { Project } from '../../../src-common/models/project';
import { NuGetApiService } from './nuget-api.service';
import { PackageManagerService } from './package-manager.service';
import { VscodeService } from './vscode.service';

describe('PackageManagerService', () => {
  let service: PackageManagerService;

  let nugetApiServiceMock: { search: jest.Mock; searchByPackageIds: jest.Mock };

  let vscodeServiceMock: { postMessage: jest.Mock };

  beforeEach(() => {
    nugetApiServiceMock = {
      search: jest.fn(),
      searchByPackageIds: jest.fn(),
    };
    vscodeServiceMock = {
      postMessage: jest.fn(),
    };
  });

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        { provide: NuGetApiService, useValue: nugetApiServiceMock },
        { provide: VscodeService, useValue: vscodeServiceMock },
      ],
    });
    service = TestBed.inject(PackageManagerService);
  });

  test('should be created', () => {
    expect(service).toBeTruthy();
  });

  test('changeCurrentSources should emit new sources', (done) => {
    const expectedSources: PackageSource[] = [getMockPackageSource()];

    service.currentSources.pipe(skip(1)).subscribe((newSources: PackageSource[]) => {
      try {
        expect(newSources).toBe(expectedSources);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentSources(expectedSources);
  });

  test('changeCurrentCategory should emit Browse by default', (done) => {
    service.currentCategory.subscribe((category: Category) => {
      try {
        expect(category).toBe(Category.Browse);
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  test('changeCurrentCategory should emit new category', (done) => {
    const expectedCategory: Category = Category.Installed;

    service.currentCategory.pipe(skip(1)).subscribe((category: Category) => {
      try {
        expect(category).toBe(expectedCategory);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentCategory(expectedCategory);
  });

  test('changeCurrentProject should emit new project and set installed info', (done) => {
    const query = 'test';
    const prerelease = false;
    const source: PackageSource = getMockPackageSource();
    const currentPackages: PackageRowModel[] = getMockApiPackages();

    const expectedProject: Project = getMockCurrentProject();
    // set current packages
    nugetApiServiceMock.search.mockReturnValue(of(currentPackages));
    service.queryForPackages(query, prerelease, source);

    service.currentProject.pipe(skip(1)).subscribe((project: Project | null) => {
      try {
        expect(project).toBe(expectedProject);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentProject(expectedProject);
  });

  test('changeCurrentSelectedPackage should emit reset current selected', (done) => {
    const selectedPackage: PackageRowModel = getMockApiPackages()[0];

    // set the versions to something other than undefined to avoid call to api
    selectedPackage.versions = [];

    const observables = [service.currentSelectedPackage, service.currentSelectedPackageId];

    // skip the initial value of the BehaviorSubject and take just one to not get the actual package
    zip(observables)
      .pipe(skip(1), take(1))
      .subscribe((results) => {
        try {
          expect(results[0]).toBeNull();
          // the id is expected to be published for highlighting the row
          expect(results[1]).toBe(selectedPackage.id);
          done();
        } catch (error) {
          done(error);
        }
      });

    service.changeCurrentSelectedPackage(selectedPackage);
  });

  test('changeCurrentSelectedPackage should emit the new package when versions present', (done) => {
    const selectedPackage: PackageRowModel = getMockApiPackages()[0];

    // set the versions to something other than undefined to avoid call to api
    selectedPackage.versions = [];

    // skip the initial value of the BehaviorSubject and reset
    service.currentSelectedPackage.pipe(skip(2)).subscribe((result) => {
      try {
        expect(result).toBe(selectedPackage);
        done();
      } catch (error) {
        done(error);
      }
    });

    service.changeCurrentSelectedPackage(selectedPackage);
  });

  test('changeCurrentSelectedPackage should emit the new package after getting versions from api', (done) => {
    const selectedPackage: PackageRowModel = getMockApiPackages()[0];
    const source: PackageSource = getMockPackageSource();

    const packageFromApi = { ...selectedPackage };
    packageFromApi.versions = [
      {
        '@id': 'versionid',
        authors: [],
        dependencyGroups: [],
        description: 'versiondesc',
        iconUrl: 'versionicon',
        id: 'vid',
        licenseUrl: 'versionLicenceUrl',
        projectUrl: 'versionProjectUrl',
        published: 'versionPublished',
        tags: [],
        version: '0.9.0',
        listed: true,
        vulnerabilities: undefined,
      },
    ];

    nugetApiServiceMock.search.mockReturnValue({
      subscribe: jest.fn(),
    });

    // need to do a search first like would happen in a real scenario to set the current source
    service.queryForPackages('', false, source);

    // skip the initial value of the BehaviorSubject and reset
    service.currentSelectedPackage.pipe(skip(2)).subscribe((result) => {
      try {
        expect(result).toBe(selectedPackage);
        expect(result?.versions).toBe(packageFromApi.versions);
        done();
      } catch (error) {
        done(error);
      }
    });

    // make the api service return the package with versions filled
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of([packageFromApi]));

    service.changeCurrentSelectedPackage(selectedPackage);
  });

  test('queryForPackages should set currents to null', (done) => {
    const query = 'test';
    const prerelease = false;
    const source: PackageSource = getMockPackageSource();

    nugetApiServiceMock.search.mockReturnValue({
      subscribe: jest.fn(),
    });

    const observables = [service.currentSelectedPackage, service.currentSelectedPackageId, service.currentPackages];

    zip(observables)
      .pipe(skip(1))
      .subscribe((results) => {
        try {
          expect(results[0]).toBeNull();
          expect(results[1]).toBeNull();
          expect(results[2]).toBeNull();
          done();
        } catch (error) {
          done(error);
        }
      });

    service.queryForPackages(query, prerelease, source);

    expect(nugetApiServiceMock.search).toBeCalledWith(query, prerelease, source);
  });

  test('queryForPackages should set current packages with installed info on browse', (done) => {
    const query = 'test';
    const prerelease = false;
    const source: PackageSource = getMockPackageSource();

    const currentProject: Project = getMockCurrentProject();

    // set the current project so that we have installed packages
    service.changeCurrentProject(currentProject);

    const expectedPackagesFromApi: PackageRowModel[] = getMockApiPackages();

    service.currentPackages.pipe(skip(2)).subscribe((packages: PackageRowModel[] | null) => {
      try {
        expect(packages).not.toBeNull();
        expect(packages).toBe(expectedPackagesFromApi);

        const firstPackage = packages?.[0];
        expect(firstPackage?.installedVersion).toBe(currentProject.packages[0].version);
        expect(firstPackage?.isInstalled).toBe(true);
        expect(firstPackage?.isOutdated).toBe(true);
        const secondPackage = packages?.[1];
        expect(secondPackage?.installedVersion).toBe(currentProject.packages[1].version);
        expect(secondPackage?.isInstalled).toBe(true);
        expect(secondPackage?.isOutdated).toBe(false);
        const thirdPackage = packages?.[2];
        expect(thirdPackage?.installedVersion).toBe('');
        expect(thirdPackage?.isInstalled).toBe(false);
        expect(thirdPackage?.isOutdated).toBe(false);

        expect(nugetApiServiceMock.searchByPackageIds).toBeCalledTimes(0);
        done();
      } catch (error) {
        done(error);
      }
    });

    nugetApiServiceMock.search.mockReturnValue(of(expectedPackagesFromApi));

    service.queryForPackages(query, prerelease, source);
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each<any>([
    [Category.Installed, 2],
    [Category.Updates, 1],
  ])(
    'queryForPackages should set current packages with installed info and filter results for category: %p',
    (category: Category, expectedResultCount: number, done: jest.DoneCallback) => {
      const query = 'test';
      const prerelease = true;
      const source: PackageSource = getMockPackageSource();

      const currentProject: Project = getMockCurrentProject();

      // set the current project so that we have installed packages
      service.changeCurrentProject(currentProject);

      // set the current category to force result filtering and searching on package ids
      service.changeCurrentCategory(category);

      // remove the third package for a realistic test scenario
      const expectedPackagesFromApi: PackageRowModel[] = getMockApiPackages().slice(0, 2);

      service.currentPackages.pipe(skip(2)).subscribe((packages: PackageRowModel[] | null) => {
        try {
          expect(packages).not.toBeNull();
          expect(packages?.length).toBe(expectedResultCount);

          const firstPackage = packages?.[0];
          expect(firstPackage?.installedVersion).toBe(currentProject.packages[0].version);
          expect(firstPackage?.isInstalled).toBe(true);
          expect(firstPackage?.isOutdated).toBe(true);

          if (category === Category.Installed) {
            const secondPackage = packages?.[1];
            expect(secondPackage?.installedVersion).toBe(currentProject.packages[1].version);
            expect(secondPackage?.isInstalled).toBe(true);
            expect(secondPackage?.isOutdated).toBe(false);
          }

          expect(nugetApiServiceMock.search).toBeCalledTimes(0);
          done();
        } catch (error) {
          done(error);
        }
      });

      nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(expectedPackagesFromApi));

      service.queryForPackages(query, prerelease, source);
    }
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  test.each<any>([
    [undefined, '1.0.0'],
    ['0.8.0', '0.8.0'],
  ])('installPackage should call postMessage with correct version', (callingVersion: string, expectedVersion: string) => {
    const packageToInstall = getMockApiPackages()[0];

    const currentProject = getMockCurrentProject();

    service.changeCurrentProject(currentProject);

    vscodeServiceMock.postMessage.mockClear();

    service.installPackage(packageToInstall, callingVersion);

    expect(vscodeServiceMock.postMessage).toBeCalledTimes(1);
    expect(vscodeServiceMock.postMessage).toBeCalledWith({
      command: 'add-package',
      projectName: currentProject.fsPath,
      packageId: packageToInstall.id,
      packageVersion: expectedVersion,
      packageSourceUrl: packageToInstall.sourceUrl,
    });
  });

  test('installPackage should call postMessage with correct version', () => {
    const packageToUninstall = getMockApiPackages()[0];

    const currentProject = getMockCurrentProject();

    service.changeCurrentProject(currentProject);

    vscodeServiceMock.postMessage.mockClear();

    service.uninstallPackage(packageToUninstall);

    expect(vscodeServiceMock.postMessage).toBeCalledTimes(1);
    expect(vscodeServiceMock.postMessage).toBeCalledWith({
      command: 'remove-package',
      projectName: currentProject.fsPath,
      packageId: packageToUninstall.id,
    });
  });

  function getMockApiPackages(): PackageRowModel[] {
    return [
      {
        authors: [],
        description: 'description',
        iconUrl: 'iconUrl',
        id: 'Package1',
        installedVersion: '',
        isInstalled: false,
        isOutdated: false,
        sourceUrl: 'sourceUrl',
        totalDownloads: 0,
        verified: false,
        version: '1.0.0',
        versions: undefined,
      },
      {
        authors: [],
        description: 'description',
        iconUrl: 'iconUrl',
        id: 'Package2',
        installedVersion: '',
        isInstalled: false,
        isOutdated: false,
        sourceUrl: 'sourceUrl',
        totalDownloads: 0,
        verified: false,
        version: '2.0.0',
        versions: undefined,
      },
      {
        authors: [],
        description: 'description',
        iconUrl: 'iconUrl',
        id: 'Package3',
        installedVersion: '',
        isInstalled: false,
        isOutdated: false,
        sourceUrl: 'sourceUrl',
        totalDownloads: 0,
        verified: false,
        version: '3.0.0',
        versions: undefined,
      },
    ];
  }

  function getMockCurrentProject(): Project {
    return {
      name: 'TestProject',
      fsPath: '/path/on/disk',
      packages: [
        {
          id: 'Package1',
          version: '0.9.0',
        },
        {
          id: 'Package2',
          version: '2.0.0',
        },
      ],
    };
  }

  function getMockPackageSource(): PackageSource {
    return {
      name: 'nuget.org',
      url: 'www.nuget.org',
      authorizationHeader: undefined,
    };
  }
});
