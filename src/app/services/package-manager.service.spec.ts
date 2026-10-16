import { TestBed } from '@angular/core/testing';
import { of, skip, Subject, take, throwError, zip } from 'rxjs';
import { Category } from '../models/category';
import { CatalogEntry } from '../models/package-meta';
import { PackageRowModel } from '../models/package-row-model';
import { PackageOperationResult } from '../../../src-common/models/extension-message';
import { PackageSource } from '../../../src-common/models/package-source';
import { InstalledPackage, Project, Solution } from '../../../src-common/models/project';
import { NuGetApiService } from './nuget-api.service';
import { PackageManagerService } from './package-manager.service';
import { VscodeService } from './vscode.service';

describe('PackageManagerService', () => {
  let service: PackageManagerService;

  let nugetApiServiceMock: { search: jest.Mock; searchByPackageIds: jest.Mock; clearPackageCache: jest.Mock };

  let vscodeServiceMock: { postMessage: jest.Mock };

  beforeEach(() => {
    nugetApiServiceMock = {
      search: jest.fn(),
      searchByPackageIds: jest.fn().mockReturnValue(of([])),
      clearPackageCache: jest.fn(),
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

  test('dismissOperationResults clears the summary and rollback action', () => {
    const result: PackageOperationResult = {
      projectPath: 'App.csproj',
      packageId: 'Package.One',
      operation: 'add',
      succeeded: false,
      message: 'Install failed.',
    };
    let latestResults: PackageOperationResult[] = [];
    let latestRollbackId: string | null = null;
    const resultsSubscription = service.operationResults.subscribe((results) => {
      latestResults = results;
    });
    const rollbackSubscription = service.rollbackId.subscribe((rollbackId) => {
      latestRollbackId = rollbackId;
    });

    service.setOperationResults([result], 'rollback-id');
    service.dismissOperationResults();

    expect(latestResults).toEqual([]);
    expect(latestRollbackId).toBeNull();
    resultsSubscription.unsubscribe();
    rollbackSubscription.unsubscribe();
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

  test('queryForPackages keeps installed results pending until project context has loaded', () => {
    const source = getMockPackageSource();
    service.changeCurrentCategory(Category.Installed);

    const state: { packages: PackageRowModel[] | null } = { packages: [] };
    service.currentPackages.subscribe((value) => (state.packages = value));
    service.queryForPackages('', false, source);

    expect(state.packages).toBeNull();
    expect(nugetApiServiceMock.searchByPackageIds).not.toHaveBeenCalled();

    service.changeCurrentProject(getMockCurrentProject());
    service.queryForPackages('', false, source);

    expect(state.packages?.map((packageRow) => packageRow.id)).toEqual(['Package1', 'Package2']);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
  });

  test('queryForPackages loads the unfiltered installed inventory locally without source metadata', () => {
    const project = getMockCurrentProject();
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Installed);

    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let loading = false;
    service.currentPackages.subscribe((value) => (state.packages = value));
    service.packageQueryLoading.subscribe((value) => (loading = value));

    service.queryForPackages('', false, getMockPackageSource());

    expect(state.packages?.map((packageRow) => packageRow.id)).toEqual(project.packages.map((item) => item.id));
    expect(state.packages?.[0].installedVersion).toBe(project.packages[0].version);
    expect(loading).toBe(false);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
  });

  test('category transitions reuse warmed installed summaries and previously loaded tab results', () => {
    const project = getMockCurrentProject();
    const source = getMockPackageSource();
    const apiPackages = getMockApiPackages().slice(0, 2);
    nugetApiServiceMock.search.mockReturnValue(of(apiPackages));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    service.changeCurrentProject(project);

    service.queryForPackages('', false, source);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
    expect(nugetApiServiceMock.search).toHaveBeenCalledTimes(1);

    service.changeCurrentCategory(Category.Installed);
    service.queryForPackages('', false, source, false);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
    expect(nugetApiServiceMock.clearPackageCache).not.toHaveBeenCalled();

    service.changeCurrentCategory(Category.Browse);
    service.queryForPackages('', false, source, false);
    service.changeCurrentCategory(Category.Installed);
    service.queryForPackages('', false, source, false);

    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
    expect(nugetApiServiceMock.search).toHaveBeenCalledTimes(1);
  });

  test('Updates warm-up retains prerelease summaries for installed packages without available updates', () => {
    const project = getMockCurrentProject();
    project.packages = [
      { id: 'Package1', version: '0.9.0', packageLevel: 'direct' },
      { id: 'Package2', version: '2.0.0', packageLevel: 'direct' },
    ];
    const source = getMockPackageSource();
    const apiPackages = getMockApiPackages().slice(0, 2).map((packageRow, index) => ({
      ...packageRow,
      version: index === 0 ? '1.0.0' : '2.0.0',
      description: `prerelease metadata ${index}`,
      iconUrl: `https://example.test/icon-${index}.png`,
    }));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Updates);

    service.queryForPackages('', true, source);

    let updateIds: string[] | undefined;
    service.currentPackages.pipe(take(1)).subscribe((packages) => {
      updateIds = packages?.map((packageRow) => packageRow.id);
    });
    expect(updateIds).toEqual(['Package1']);

    service.changeCurrentCategory(Category.Installed);
    service.queryForPackages('', true, source, false);

    const installedState: { packages: PackageRowModel[] | null } = { packages: null };
    service.currentPackages.pipe(take(1)).subscribe((packages) => {
      installedState.packages = packages;
    });
    expect(installedState.packages?.map((packageRow) => packageRow.id)).toEqual(['Package1', 'Package2']);
    expect(installedState.packages?.map((packageRow) => packageRow.iconUrl)).toEqual([
      'https://example.test/icon-0.png',
      'https://example.test/icon-1.png',
    ]);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
  });

  test('Updates filter prerelease-warmed summaries to newer versions and keep the count consistent', () => {
    const project = getMockCurrentProject();
    project.packages = [
      { id: 'Package1', version: '0.9.0', packageLevel: 'direct' },
      { id: 'Package2', version: '2.0.0', packageLevel: 'direct' },
    ];
    const source = getMockPackageSource();
    const apiPackages = getMockApiPackages().slice(0, 2).map((packageRow, index) => ({
      ...packageRow,
      version: index === 0 ? '1.0.0-rc.1' : '2.0.0',
      iconUrl: `https://example.test/icon-${index}.png`,
    }));
    nugetApiServiceMock.search.mockReturnValue(of(apiPackages));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let updateCount = { count: null as number | null, loading: false };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    service.availableUpdateCount.subscribe((value) => (updateCount = value));
    service.changeCurrentProject(project);

    service.queryForPackages('', true, source);
    service.changeCurrentCategory(Category.Updates);
    service.queryForPackages('', true, source, false);

    expect(state.packages?.map((packageRow) => packageRow.id)).toEqual(['Package1']);
    expect(state.packages?.[0].version).toBe('1.0.0-rc.1');
    expect(updateCount).toEqual({ count: 1, loading: false });
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
  });

  test('Updates show no packages when prerelease-warmed summaries contain no newer versions', () => {
    const project = getMockCurrentProject();
    project.packages = [
      { id: 'Package1', version: '1.0.0-rc.1', packageLevel: 'direct' },
      { id: 'Package2', version: '2.0.0', packageLevel: 'direct' },
    ];
    const source = getMockPackageSource();
    const apiPackages = getMockApiPackages().slice(0, 2).map((packageRow, index) => ({
      ...packageRow,
      version: index === 0 ? '1.0.0-rc.1' : '2.0.0',
    }));
    nugetApiServiceMock.search.mockReturnValue(of(apiPackages));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let updateCount = { count: null as number | null, loading: false };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    service.availableUpdateCount.subscribe((value) => (updateCount = value));
    service.changeCurrentProject(project);

    service.queryForPackages('', true, source);
    service.changeCurrentCategory(Category.Updates);
    service.queryForPackages('', true, source, false);

    expect(state.packages).toEqual([]);
    expect(updateCount).toEqual({ count: 0, loading: false });
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);
  });

  test('manual refresh clears cached tab results and package summaries', () => {
    const project = getMockCurrentProject();
    const source = getMockPackageSource();
    const apiPackages = getMockApiPackages().slice(0, 2);
    nugetApiServiceMock.search.mockReturnValue(of(apiPackages));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Installed);

    service.queryForPackages('', false, source, false);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(1);

    service.queryForPackages('', false, source, true, true);

    expect(nugetApiServiceMock.clearPackageCache).toHaveBeenCalledWith(source);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(2);
  });

  test('changed project inventory invalidates cached tab results and reuses refreshed summaries', () => {
    const firstProject = getMockCurrentProject();
    const secondProject = getMockCurrentProject();
    secondProject.packages = [{ id: 'Package3', version: '2.0.0', packageLevel: 'direct' }];
    const source = getMockPackageSource();
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(getMockApiPackages()));
    service.changeCurrentProject(firstProject);
    service.changeCurrentCategory(Category.Installed);
    service.queryForPackages('', false, source, false);

    service.changeCurrentProject(secondProject);
    service.queryForPackages('', false, source, false);

    let packageIds: string[] | undefined;
    service.currentPackages.pipe(take(1)).subscribe((packages) => {
      packageIds = packages?.map((packageRow) => packageRow.id);
    });
    expect(packageIds).toEqual(['Package3']);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(2);
  });

  test('changed solution inventory invalidates cached tab results and uses current package ids', () => {
    const firstSolution = getMockSolution();
    firstSolution.projects[0].packages = [{ id: 'Package1', version: '1.0.0', packageLevel: 'direct' }];
    firstSolution.projects[1].packages = [];
    const secondSolution = getMockSolution();
    secondSolution.projects[0].packages = [{ id: 'Package3', version: '2.0.0', packageLevel: 'direct' }];
    secondSolution.projects[1].packages = [];
    const source = getMockPackageSource();
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(getMockApiPackages()));
    service.changeCurrentSolution(firstSolution);
    service.changeCurrentCategory(Category.Installed);
    service.queryForPackages('', false, source, false);

    service.changeCurrentSolution(secondSolution);
    service.queryForPackages('', false, source, false);

    let packageIds: string[] | undefined;
    service.currentPackages.pipe(take(1)).subscribe((packages) => {
      packageIds = packages?.map((packageRow) => packageRow.id);
    });
    expect(packageIds).toEqual(['Package3']);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(2);
  });

  test('installed prerelease-only summaries add icons without changing installed versions or update counts', () => {
    const project = getMockCurrentProject();
    const prereleaseOnlySummary = { ...getMockApiPackages()[0], version: '', iconUrl: 'https://example.test/icon.png' };
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let updateCount = { count: null as number | null, loading: false };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    service.availableUpdateCount.subscribe((state) => (updateCount = state));
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Installed);
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of([prereleaseOnlySummary]));

    service.queryForPackages('', false, getMockPackageSource());

    const installedPackage = state.packages?.find((packageRow) => packageRow.id === prereleaseOnlySummary.id);
    expect(installedPackage).toMatchObject({
      version: project.packages[0].version,
      installedVersion: project.packages[0].version,
      iconUrl: 'https://example.test/icon.png',
      isInstalled: true,
      isOutdated: false,
    });
    expect(updateCount).toEqual({ count: 0, loading: false });
  });

  test('updates query only direct package ids and excludes transitive-only updates', (done) => {
    const solution = getMockSolution();
    solution.projects[0].packages = [
      { id: 'Package1', version: '0.9.0', packageLevel: 'direct' },
      { id: 'Package3', version: '2.0.0', packageLevel: 'transitive' },
    ];
    solution.projects[1].packages = [{ id: 'Package3', version: '2.1.0', packageLevel: 'transitive' }];
    const apiPackages = getMockApiPackages();
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    service.changeCurrentSolution(solution);
    service.changeCurrentCategory(Category.Updates);
    service.currentPackages.pipe(skip(2), take(1)).subscribe((packages) => {
      expect(packages?.map((packageRow) => packageRow.id)).toEqual(['Package1']);
      expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenLastCalledWith(
        ['Package1', 'Package3'],
        '',
        false,
        getMockPackageSource(),
        false
      );
      done();
    });

    service.queryForPackages('', false, getMockPackageSource());
  });

  test.each([
    ['11.0.0-rc.2', '10.0.13', 0],
    ['11.0.0-rc.2', '11.0.0', 1],
    ['10.0.13', '11.0.0', 1],
  ])(
    'updates compare versions instead of treating every mismatch as an update (%s installed, %s available)',
    (installedVersion: string, availableVersion: string, expectedUpdateCount: number) => {
      const project = getMockCurrentProject();
      const packageId = getMockApiPackages()[0].id;
      project.packages = [{ id: packageId, version: installedVersion, packageLevel: 'direct' }];
      const availablePackage = { ...getMockApiPackages()[0], version: availableVersion };
      const state: { packages: PackageRowModel[] | null } = { packages: null };
      let updateCount = { count: null as number | null, loading: false };
      service.currentPackages.subscribe((packages) => (state.packages = packages));
      service.availableUpdateCount.subscribe((value) => (updateCount = value));
      nugetApiServiceMock.searchByPackageIds.mockReturnValue(of([availablePackage]));
      service.changeCurrentProject(project);
      service.changeCurrentCategory(Category.Updates);

      service.queryForPackages('', false, getMockPackageSource());

      expect(state.packages?.map((packageRow) => packageRow.id)).toEqual(expectedUpdateCount ? [packageId] : []);
      expect(updateCount).toEqual({ count: expectedUpdateCount, loading: false });
    }
  );

  test('exact requested versions suppress updates outside the pin', () => {
    const packageId = getMockApiPackages()[0].id;
    const project = getMockCurrentProject();
    project.packages = [getPackageWithRequestedVersion(packageId, '7.0.0', '[7.0.0]')];
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let updateCount = { count: null as number | null, loading: false };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    service.availableUpdateCount.subscribe((value) => (updateCount = value));
    nugetApiServiceMock.searchByPackageIds
      .mockReturnValueOnce(of([{ ...getMockApiPackages()[0], version: '9.0.0' }]))
      .mockReturnValueOnce(of([{ ...getMockApiPackages()[0], version: '9.0.0', versions: [getMockCatalogEntry(packageId, '9.0.0')] }]));
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Updates);

    service.queryForPackages('', false, getMockPackageSource());

    expect(state.packages).toEqual([]);
    expect(updateCount).toEqual({ count: 0, loading: false });
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledTimes(2);
  });

  test('bounded requested versions select the newest available version within the range', () => {
    const packageId = getMockApiPackages()[0].id;
    const project = getMockCurrentProject();
    project.packages = [getPackageWithRequestedVersion(packageId, '7.0.0', '[7.0.0, 8.0.0)')];
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let updateCount = { count: null as number | null, loading: false };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    service.availableUpdateCount.subscribe((value) => (updateCount = value));
    nugetApiServiceMock.searchByPackageIds
      .mockReturnValueOnce(of([{ ...getMockApiPackages()[0], version: '9.0.0' }]))
      .mockReturnValueOnce(
        of([
          {
            ...getMockApiPackages()[0],
            version: '9.0.0',
            versions: ['9.0.0', '7.9.0', '7.0.0'].map((version) => getMockCatalogEntry(packageId, version)),
          },
        ])
      );
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Updates);

    service.queryForPackages('', false, getMockPackageSource());

    expect(state.packages?.map((packageRow) => [packageRow.id, packageRow.version])).toEqual([[packageId, '7.9.0']]);
    expect(updateCount).toEqual({ count: 1, loading: false });
  });

  test('bounded requested versions suppress updates when no newer version fits the range', () => {
    const packageId = getMockApiPackages()[0].id;
    const project = getMockCurrentProject();
    project.packages = [getPackageWithRequestedVersion(packageId, '7.5.0', '[7.0.0, 8.0.0)')];
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    let updateCount = { count: null as number | null, loading: false };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    service.availableUpdateCount.subscribe((value) => (updateCount = value));
    nugetApiServiceMock.searchByPackageIds
      .mockReturnValueOnce(of([{ ...getMockApiPackages()[0], version: '9.0.0' }]))
      .mockReturnValueOnce(
        of([
          {
            ...getMockApiPackages()[0],
            version: '9.0.0',
            versions: ['9.0.0', '7.5.0', '7.0.0'].map((version) => getMockCatalogEntry(packageId, version)),
          },
        ])
      );
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Updates);

    service.queryForPackages('', false, getMockPackageSource());

    expect(state.packages).toEqual([]);
    expect(updateCount).toEqual({ count: 0, loading: false });
  });

  test('solution updates only target projects whose requested version accepts the selected candidate', () => {
    const packageId = getMockApiPackages()[0].id;
    const solution = getMockSolution();
    solution.projects[0].packages = [getPackageWithRequestedVersion(packageId, '7.0.0', '[7.0.0, 8.0.0)')];
    solution.projects[1].packages = [getPackageWithRequestedVersion(packageId, '8.0.0', '[8.0.0, 9.0.0)')];
    const state: { packages: PackageRowModel[] | null } = { packages: null };
    service.currentPackages.subscribe((packages) => (state.packages = packages));
    nugetApiServiceMock.searchByPackageIds
      .mockReturnValueOnce(of([{ ...getMockApiPackages()[0], version: '9.0.0' }]))
      .mockReturnValueOnce(
        of([
          {
            ...getMockApiPackages()[0],
            version: '9.0.0',
            versions: ['9.0.0', '8.5.0', '7.9.0', '7.0.0'].map((version) => getMockCatalogEntry(packageId, version)),
          },
        ])
      );
    service.changeCurrentSolution(solution);
    service.changeCurrentCategory(Category.Updates);

    service.queryForPackages('', false, getMockPackageSource());

    expect(state.packages?.map((packageRow) => [packageRow.id, packageRow.version])).toEqual([[packageId, '8.5.0']]);
    service.installPackages(state.packages ?? []);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'update-packages-batch',
        updates: [
          expect.objectContaining({
            packageId,
            packageVersion: '8.5.0',
            projectPaths: [solution.projects[1].fsPath],
          }),
        ],
      })
    );
  });

  test('initial browse load primes summaries for all installed packages and keeps startup loading visible', () => {
    const project = getMockCurrentProject();
    project.packages[1].packageLevel = 'transitive';
    const source = getMockPackageSource();
    const summaryRequest = new Subject<PackageRowModel[]>();
    nugetApiServiceMock.search.mockReturnValue(of([]));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(summaryRequest);
    service.changeCurrentProject(project);

    let contextLoading: string | null = null;
    service.contextLoading.subscribe((state) => (contextLoading = state?.message ?? null));
    service.queryForPackages('', false, source);

    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledWith(
      project.packages.map((installedPackage) => installedPackage.id),
      '',
      false,
      source,
      false
    );
    expect(contextLoading).toBe('Loading installed package information from the selected source...');

    summaryRequest.next(getMockApiPackages());

    expect(contextLoading).toBeNull();
  });

  test('consolidation filters to differing direct versions and ignores transitive-only or matching versions', () => {
    const solution = getMockSolution();
    solution.projects[0].packages = [
      { id: 'Package1', version: '1.0.0', packageLevel: 'direct' },
      { id: 'Package2', version: '1.0.0', packageLevel: 'direct' },
      { id: 'Package3', version: '1.0.0', packageLevel: 'direct' },
      { id: 'Package4', version: '1.0.0', packageLevel: 'transitive' },
      { id: 'Package5', version: '1.0.0', packageLevel: 'direct' },
      getFrameworkSpecificPackage('Package6', ['1.0.0', '2.0.0']),
      getFrameworkSpecificPackage('Package7', ['1.0.0', '2.0.0']),
    ];
    solution.projects[1].packages = [
      { id: 'package1', version: '2.0.0', packageLevel: 'direct' },
      { id: 'Package2', version: '1.0.0', packageLevel: 'direct' },
      { id: 'Package3', version: '2.0.0', packageLevel: 'transitive' },
      { id: 'Package4', version: '2.0.0', packageLevel: 'transitive' },
      getFrameworkSpecificPackage('Package6', ['2.0.0', '1.0.0']),
      getFrameworkSpecificPackage('Package7', ['1.0.0', '3.0.0']),
    ];
    const apiPackages = ['Package1', 'Package2', 'Package3', 'Package4', 'Package5', 'Package6', 'Package7'].map((id) => ({
      ...getMockApiPackages()[0],
      id,
    }));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(apiPackages));
    service.changeCurrentSolution(solution);
    service.changeCurrentCategory(Category.Consolidate);

    service.queryForPackages('', false, getMockPackageSource());

    service.currentPackages.pipe(take(1)).subscribe((packages) => {
      expect(packages?.map((packageRow) => packageRow.id)).toEqual(['Package1', 'Package7']);
    });
    expect(service.consolidationCount).toBe(2);
    expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledWith(
      ['package1', 'Package2', 'Package3', 'Package4', 'Package5', 'Package6', 'Package7'],
      '',
      false,
      getMockPackageSource(),
      false
    );
  });

  test('falls back to Installed when Consolidate is no longer available in the active context', () => {
    const solution = getMockSolution();
    solution.projects[0].packages = [{ id: 'Package1', version: '1.0.0', packageLevel: 'direct' }];
    solution.projects[1].packages = [{ id: 'Package1', version: '2.0.0', packageLevel: 'direct' }];
    service.changeCurrentCategory(Category.Consolidate);
    service.changeCurrentSolution(solution);
    expect(service.consolidationCount).toBe(1);
    expectCategory(service, Category.Consolidate);

    solution.projects[1].packages[0].version = '1.0.0';
    service.changeCurrentSolution(solution);
    expect(service.consolidationCount).toBe(0);
    expectCategory(service, Category.Installed);

    service.changeCurrentCategory(Category.Consolidate);
    service.changeCurrentProject(getMockCurrentProject());
    expectCategory(service, Category.Installed);
  });

  test('update count is unique and based on direct packages only', (done) => {
    const solution = getMockSolution();
    solution.projects[0].packages = [
      { id: 'Package1', version: '0.9.0', packageLevel: 'direct' },
      { id: 'Package3', version: '2.0.0', packageLevel: 'transitive' },
    ];
    solution.projects[1].packages = [
      { id: 'Package1', version: '0.8.0', packageLevel: 'direct' },
      { id: 'Package2', version: '2.0.0', packageLevel: 'direct' },
    ];
    nugetApiServiceMock.search.mockReturnValue(of([]));
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of(getMockApiPackages()));
    service.changeCurrentSolution(solution);
    service.changeCurrentCategory(Category.Updates);
    service.availableUpdateCount.pipe(skip(2), take(1)).subscribe((state) => {
      expect(state).toEqual({ count: 1, loading: false });
      expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledWith(
        ['Package1', 'Package3', 'Package2'],
        '',
        false,
        getMockPackageSource(),
        false
      );
      done();
    });

    service.queryForPackages('', false, getMockPackageSource());
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

    expect(nugetApiServiceMock.search).toHaveBeenCalledWith(query, prerelease, source);
  });

  test('queryForPackages restores the selected package from refreshed results', () => {
    const source = getMockPackageSource();
    const initialPackages = getMockApiPackages();
    initialPackages[0].versions = [];
    nugetApiServiceMock.search.mockReturnValue(of(initialPackages));
    service.queryForPackages('', false, source);
    service.changeCurrentSelectedPackage(initialPackages[0]);

    const refreshedPackages = getMockApiPackages();
    refreshedPackages[0].versions = [];
    nugetApiServiceMock.search.mockReturnValue(of(refreshedPackages));

    let selectedPackage: PackageRowModel | null = null;
    let selectedPackageId: string | null = null;
    service.currentSelectedPackage.subscribe((packageRow) => {
      selectedPackage = packageRow;
    });

    service.currentSelectedPackageId.subscribe((packageId) => {
      selectedPackageId = packageId;
    });

    service.queryForPackages('', false, source);

    expect(selectedPackage).toBe(refreshedPackages[0]);
    expect(selectedPackageId).toBe(refreshedPackages[0].id);
  });

  test('queryForPackages_onBrowseFailurePublishesSafeErrorAndRetryClearsIt', () => {
    const source = { ...getMockPackageSource(), authorizationHeader: 'Bearer test-token' };
    let packages: PackageRowModel[] | null = [];
    let errorMessage: string | null = null;
    service.currentPackages.subscribe((value) => (packages = value));
    service.currentPackagesError.subscribe((value) => (errorMessage = value));
    nugetApiServiceMock.search.mockReturnValue(throwError(() => new Error(`Request failed for ${source.url} ${source.authorizationHeader}`)));

    service.queryForPackages('widget', false, source);

    expect(packages).toBeNull();
    expect(errorMessage).toBe('Packages could not be loaded from the selected source. Check the source settings or connection, then refresh.');
    expect(errorMessage).not.toContain(source.authorizationHeader);

    const expectedPackages = getMockApiPackages();
    nugetApiServiceMock.search.mockReturnValue(of(expectedPackages));
    service.queryForPackages('widget', false, source);

    expect(packages).toBe(expectedPackages);
    expect(errorMessage).toBeNull();
  });

  test('queryForPackages_onInstalledFeedFailurePublishesVisibleError', () => {
    const source = getMockPackageSource();
    const project = getMockCurrentProject();
    service.changeCurrentProject(project);
    service.changeCurrentCategory(Category.Installed);
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(throwError(() => new Error('Private feed unavailable')));
    let errorMessage: string | null = null;
    service.currentPackagesError.subscribe((value) => (errorMessage = value));

    service.queryForPackages('p', false, source);

    expect(errorMessage).toBe('Packages could not be loaded from the selected source. Check the source settings or connection, then refresh.');
  });

  test('changeCurrentSelectedPackage_onMetadataFailureShowsErrorAndCanRecover', () => {
    const source = { ...getMockPackageSource(), authorizationHeader: 'Bearer test-token' };
    nugetApiServiceMock.search.mockReturnValue(of(getMockApiPackages()));
    service.queryForPackages('', false, source);
    const selectedPackage = { ...getMockApiPackages()[0], versions: undefined };
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(throwError(() => new Error(`Request failed ${source.authorizationHeader}`)));
    let selectedPackageError: string | null = null;
    let currentPackage: PackageRowModel | null = null;
    service.currentSelectedPackageError.subscribe((value) => (selectedPackageError = value));
    service.currentSelectedPackage.subscribe((value) => (currentPackage = value));

    service.changeCurrentSelectedPackage(selectedPackage);

    expect(currentPackage).toBeNull();
    expect(selectedPackageError).toBe(
      'Package details could not be loaded from the selected source. Check the source settings or connection and retry.'
    );
    expect(selectedPackageError).not.toContain(source.authorizationHeader);

    const withVersions = { ...selectedPackage, versions: [] };
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of([withVersions]));
    service.changeCurrentSelectedPackage(selectedPackage);

    expect(currentPackage).toBe(selectedPackage);
    expect(selectedPackage.versions).toEqual([]);
    expect(selectedPackageError).toBeNull();
  });

  test('changeCurrentSelectedPackage_whenSourceDoesNotReturnPackageShowsError', () => {
    const source = getMockPackageSource();
    nugetApiServiceMock.search.mockReturnValue(of([]));
    service.queryForPackages('', false, source);
    nugetApiServiceMock.searchByPackageIds.mockReturnValue(of([]));
    let errorMessage: string | null = null;
    service.currentSelectedPackageError.subscribe((value) => (errorMessage = value));

    service.changeCurrentSelectedPackage({ ...getMockApiPackages()[0], versions: undefined });

    expect(errorMessage).toBe('Package details were not returned by the selected source. Check the source settings and retry.');
  });

  test('queryForPackages clears the selected package when it is no longer in the results', () => {
    const source = getMockPackageSource();
    const initialPackages = getMockApiPackages();
    initialPackages[0].versions = [];
    nugetApiServiceMock.search.mockReturnValue(of(initialPackages));
    service.queryForPackages('', false, source);
    service.changeCurrentSelectedPackage(initialPackages[0]);

    nugetApiServiceMock.search.mockReturnValue(of([]));

    let selectedPackage: PackageRowModel | null = initialPackages[0];
    let selectedPackageId: string | null = initialPackages[0].id;
    let packages: PackageRowModel[] | null = initialPackages;
    service.currentSelectedPackage.subscribe((packageRow) => {
      selectedPackage = packageRow;
    });
    service.currentSelectedPackageId.subscribe((packageId) => {
      selectedPackageId = packageId;
    });
    service.currentPackages.subscribe((packageRows) => {
      packages = packageRows;
    });

    service.queryForPackages('', false, source);

    expect(selectedPackage).toBeNull();
    expect(selectedPackageId).toBeNull();
    expect(packages).toEqual([]);
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

        expect(nugetApiServiceMock.searchByPackageIds).toHaveBeenCalledWith(
          ['Package1', 'Package2'],
          '',
          prerelease,
          source,
          false
        );
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
      const expectedPackagesFromApi: PackageRowModel[] = getMockApiPackages()
        .slice(0, 2)
        .map((packageRow) => ({ ...packageRow, description: 'test package description' }));

      const emissionToCheck = 2;
      service.currentPackages.pipe(skip(emissionToCheck)).subscribe((packages: PackageRowModel[] | null) => {
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

          expect(nugetApiServiceMock.search).toHaveBeenCalledTimes(0);
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

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledTimes(1);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'add-package',
      projectName: currentProject.fsPath,
      packageId: packageToInstall.id,
      packageVersion: expectedVersion,
      packageSourceUrl: packageToInstall.sourceUrl,
    }));
    expect(vscodeServiceMock.postMessage.mock.calls[0][0].operationId).toEqual(expect.any(String));
  });

  test('installPackage does not apply an explicit version outside the installed package range', () => {
    const packageToInstall = { ...getMockApiPackages()[0], version: '9.0.0' };
    const currentProject = getMockCurrentProject();
    currentProject.packages = [getPackageWithRequestedVersion(packageToInstall.id, '7.0.0', '[7.0.0]')];
    service.changeCurrentProject(currentProject);
    vscodeServiceMock.postMessage.mockClear();

    service.installPackage(packageToInstall, '9.0.0');

    expect(vscodeServiceMock.postMessage).not.toHaveBeenCalled();
  });

  test('installPackage should call postMessage with correct version', () => {
    const packageToUninstall = getMockApiPackages()[0];

    const currentProject = getMockCurrentProject();

    service.changeCurrentProject(currentProject);

    vscodeServiceMock.postMessage.mockClear();

    service.uninstallPackage(packageToUninstall);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledTimes(1);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'remove-package',
      projectName: currentProject.fsPath,
      packageId: packageToUninstall.id,
    }));
  });

  test('solution package results aggregate installed versions across projects', () => {
    const apiPackages = getMockApiPackages();
    const solution = getMockSolution();
    solution.projects[0].packages = [{ id: 'Package1', version: '0.9.0', versionSource: 'central', packageLevel: 'direct' }];
    solution.projects[1].packages = [{ id: 'Package1', version: '0.8.0', versionSource: 'override', packageLevel: 'transitive' }];
    nugetApiServiceMock.search.mockReturnValue(of(apiPackages));

    service.changeCurrentSolution(solution);
    service.queryForPackages('', false, getMockPackageSource());

    const aggregatedPackage = apiPackages[0];
    expect(aggregatedPackage.isInstalled).toBe(true);
    expect(aggregatedPackage.installedVersion).toBe('Varies by project');
    expect(aggregatedPackage.isOutdated).toBe(true);
    expect(aggregatedPackage.versionSource).toBe('mixed');
    expect(aggregatedPackage.packageLevel).toBe('mixed');
    expect(aggregatedPackage.solutionProjectStates).toEqual([
      expect.objectContaining({ projectPath: solution.projects[0].fsPath, installedVersion: '0.9.0', versionSource: 'central' }),
      expect.objectContaining({ projectPath: solution.projects[1].fsPath, installedVersion: '0.8.0', versionSource: 'override' }),
    ]);
  });

  test('solution installs target selected projects and pass the CPM exception preference', () => {
    const solution = getMockSolution();
    const packageToInstall = getMockApiPackages()[0];
    service.changeCurrentSolution(solution);
    service.selectProjectsForPackage(packageToInstall.id, [solution.projects[1].fsPath]);
    vscodeServiceMock.postMessage.mockClear();

    service.installPackage(packageToInstall, '0.8.0');

    expect(vscodeServiceMock.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      command: 'add-package-to-projects',
      projectPaths: [solution.projects[1].fsPath],
      packageId: packageToInstall.id,
      packageVersion: '0.8.0',
      packageSourceUrl: packageToInstall.sourceUrl,
      includeCpmExceptions: false,
    }));
    const firstOperationId = vscodeServiceMock.postMessage.mock.calls[0][0].operationId;
    service.completePackageOperation(firstOperationId);

    service.installPackage(packageToInstall, undefined, undefined, true);
    expect(vscodeServiceMock.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: 'add-package-to-projects',
        includeCpmExceptions: true,
      })
    );
  });

  test('solution keeps project selections scoped to each package', () => {
    const solution = getMockSolution();
    service.changeCurrentSolution(solution);
    service.selectProjectsForPackage('Package1', [solution.projects[0].fsPath]);
    service.selectProjectsForPackage('Package2', [solution.projects[1].fsPath]);

    expect(service.selectedProjectsForPackage('Package1')).toEqual([solution.projects[0].fsPath]);
    expect(service.selectedProjectsForPackage('Package2')).toEqual([solution.projects[1].fsPath]);
    expect(service.selectedProjectsForPackage('Package3')).toEqual([]);
  });

  test('solution install does nothing until projects are checked for that package', () => {
    service.changeCurrentSolution(getMockSolution());
    vscodeServiceMock.postMessage.mockClear();

    service.installPackage(getMockApiPackages()[0]);

    expect(vscodeServiceMock.postMessage).not.toHaveBeenCalled();
  });

  test('solution uninstall targets selected projects where the package is installed', () => {
    const solution = getMockSolution();
    solution.projects[0].packages = [{ id: 'Package1', version: '0.9.0' }];
    solution.projects[1].packages = [{ id: 'Package1', version: '0.8.0', packageLevel: 'transitive' }];
    service.changeCurrentSolution(solution);
    service.selectProjectsForPackage('Package1', solution.projects.map((project) => project.fsPath));
    vscodeServiceMock.postMessage.mockClear();

    service.uninstallPackage(getMockApiPackages()[0]);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      command: 'remove-package-from-projects',
      projectPaths: [solution.projects[0].fsPath],
      packageId: 'Package1',
    }));
  });

  test('keeps package updates busy until the batch completes', () => {
    service.changeCurrentProject(getMockCurrentProject());
    vscodeServiceMock.postMessage.mockClear();
    service.installPackages(getMockApiPackages());

    expect(service.isPackageOperationInProgress).toBe(true);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledTimes(1);
    expect(vscodeServiceMock.postMessage.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        command: 'update-packages-batch',
        updates: [
          expect.objectContaining({
            projectPaths: ['/path/on/disk'],
            packageId: 'Package1',
            packageVersion: '1.0.0',
          }),
        ],
      })
    );

    const operationId = vscodeServiceMock.postMessage.mock.calls[0][0].operationId;
    service.installPackage(getMockApiPackages()[0]);
    expect(vscodeServiceMock.postMessage).toHaveBeenCalledTimes(1);

    service.completePackageOperation(operationId);
    expect(service.isPackageOperationInProgress).toBe(false);
  });

  test('solution bulk updates target direct outdated references across projects by default', () => {
    const solution = getMockSolution();
    solution.projects[0].packages = [{ id: 'Package1', version: '0.9.0', packageLevel: 'direct' }];
    solution.projects[1].packages = [
      { id: 'Package1', version: '0.8.0', packageLevel: 'transitive' },
      { id: 'Package2', version: '1.0.0', packageLevel: 'direct' },
    ];
    service.changeCurrentSolution(solution);

    service.installPackages([getMockApiPackages()[0], getMockApiPackages()[1]]);

    expect(vscodeServiceMock.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'update-packages-batch',
        updates: [
          expect.objectContaining({ packageId: 'Package1', projectPaths: [solution.projects[0].fsPath] }),
          expect.objectContaining({ packageId: 'Package2', projectPaths: [solution.projects[1].fsPath] }),
        ],
      })
    );
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

  function getMockSolution(): Solution {
    return {
      name: 'Test.slnx',
      fsPath: '/path/on/disk/Test.slnx',
      projects: [
        { name: 'Project1', fsPath: '/path/on/disk/Project1.csproj', packages: [], managePackageVersionsCentrally: true },
        { name: 'Project2', fsPath: '/path/on/disk/Project2.csproj', packages: [], managePackageVersionsCentrally: true },
      ],
      unsupportedProjects: [],
      loadFailures: [],
    };
  }

  function getMockPackageSource(): PackageSource {
    return {
      name: 'nuget.org',
      url: 'www.nuget.org',
      authorizationHeader: undefined,
    };
  }

  function expectCategory(packageManager: PackageManagerService, expectedCategory: Category): void {
    let category: Category | undefined;
    packageManager.currentCategory.pipe(take(1)).subscribe((value) => {
      category = value;
    });
    expect(category).toBe(expectedCategory);
  }
});

function getFrameworkSpecificPackage(id: string, versions: string[]): InstalledPackage {
  return {
    id,
    version: 'Varies by target framework',
    packageLevel: 'direct',
    targetFrameworkVersions: versions.map((version, index) => ({
      targetFramework: `net${9 + index}.0`,
      version,
      versionSource: 'central',
      packageLevel: 'direct',
    })),
  };
}

function getPackageWithRequestedVersion(id: string, version: string, requestedVersion: string): InstalledPackage {
  return {
    id,
    version,
    packageLevel: 'direct',
    targetFrameworkVersions: [
      {
        targetFramework: 'net8.0',
        version,
        requestedVersion,
        versionSource: 'central',
        packageLevel: 'direct',
      },
    ],
  };
}

function getMockCatalogEntry(id: string, version: string): CatalogEntry {
  return {
    '@id': `https://example.test/${id}/${version}`,
    id,
    version,
    dependencyGroups: undefined,
    listed: true,
  };
}
