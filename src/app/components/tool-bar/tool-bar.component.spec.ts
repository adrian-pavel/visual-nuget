import { UntypedFormBuilder } from '@angular/forms';
import { BehaviorSubject } from 'rxjs';

import { PackageSource } from '../../../../src-common/models/package-source';
import { Project, Solution } from '../../../../src-common/models/project';
import { Category } from '../../models/category';
import { NUGET_ORG } from '../../models/constants';
import { PackageManagerService } from '../../services/package-manager.service';
import { VscodeService } from '../../services/vscode.service';
import { ToolBarComponent } from './tool-bar.component';

describe('ToolBarComponent', () => {
  test('refreshes the active package query when project or solution state reloads', () => {
    const source: PackageSource = { name: 'Test feed', url: 'https://example.test/v3/index.json', authorizationHeader: undefined };
    const packageManagerMock = {
      currentSources: new BehaviorSubject<PackageSource[]>([source]),
      currentCategory: new BehaviorSubject<Category>(Category.Updates),
      currentProject: new BehaviorSubject<Project | null>(null),
      currentSolution: new BehaviorSubject<Solution | null>(null),
      queryForPackages: jest.fn(),
    };
    const component = new ToolBarComponent(
      packageManagerMock as unknown as PackageManagerService,
      new UntypedFormBuilder(),
      { postMessage: jest.fn() } as unknown as VscodeService
    );

    component.ngOnInit();
    const project: Project = { name: 'Test project', fsPath: 'Test.csproj', packages: [] };
    packageManagerMock.currentProject.next(project);
    packageManagerMock.currentSolution.next({
      name: 'Test solution',
      fsPath: 'Test.slnx',
      projects: [project],
      unsupportedProjects: [],
      loadFailures: [],
    });

    expect(packageManagerMock.currentCategory.value).toBe(Category.Updates);
    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('', false, source, true, false);
    expect(packageManagerMock.queryForPackages).toHaveBeenCalledTimes(3);

    component.ngOnDestroy();
  });

  test('routes the entered query, prerelease flag, and selected feed to package search', () => {
    const source: PackageSource = {
      name: 'Test feed',
      url: 'https://example.test/v3/index.json',
      authorizationHeader: 'Basic test',
    };
    const { component, packageManagerMock } = createToolbar([source]);

    component.searchForm?.patchValue({ query: 'Widget', prerelease: true, source });
    component.refresh();

    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('Widget', true, source, true, false);
    component.ngOnDestroy();
  });

  test('uses NuGet.org when no package feeds are configured', () => {
    const { component, packageManagerMock } = createToolbar([]);

    component.refresh();

    expect(component.packageSources).toEqual([NUGET_ORG]);
    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('', false, NUGET_ORG, true, false);
    component.ngOnDestroy();
  });

  test('uses the newly configured feed after source configuration changes', () => {
    const initialSource: PackageSource = {
      name: 'Initial feed',
      url: 'https://initial.example.test/v3/index.json',
      authorizationHeader: undefined,
    };
    const updatedSource: PackageSource = {
      name: 'Updated feed',
      url: 'https://updated.example.test/v3/index.json',
      authorizationHeader: undefined,
    };
    const { component, packageManagerMock, currentSources } = createToolbar([initialSource]);

    currentSources.next([updatedSource]);
    component.refresh();

    expect(component.packageSources).toEqual([updatedSource]);
    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('', false, updatedSource, true, false);
    component.ngOnDestroy();
  });

  test('does not force refresh when the user changes package tabs', () => {
    const source: PackageSource = { name: 'Test feed', url: 'https://example.test/v3/index.json', authorizationHeader: undefined };
    const { component, packageManagerMock } = createToolbar([source]);

    packageManagerMock.currentCategory.next(Category.Installed);

    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('', false, source, false, false);
    component.ngOnDestroy();
  });

  test('explicit refresh bypasses cached package results and feed metadata', () => {
    const source: PackageSource = { name: 'Test feed', url: 'https://example.test/v3/index.json', authorizationHeader: undefined };
    const { component, packageManagerMock } = createToolbar([source]);

    component.refresh(true, true);

    expect(packageManagerMock.queryForPackages).toHaveBeenLastCalledWith('', false, source, true, true);
    component.ngOnDestroy();
  });
});

function createToolbar(sources: PackageSource[]) {
  const currentSources = new BehaviorSubject<PackageSource[]>(sources);
  const packageManagerMock = {
    currentSources,
    currentCategory: new BehaviorSubject<Category>(Category.Browse),
    currentProject: new BehaviorSubject<Project | null>(null),
    currentSolution: new BehaviorSubject<Solution | null>(null),
    queryForPackages: jest.fn(),
  };
  const component = new ToolBarComponent(
    packageManagerMock as unknown as PackageManagerService,
    new UntypedFormBuilder(),
    { postMessage: jest.fn() } as unknown as VscodeService
  );
  component.ngOnInit();

  return { component, packageManagerMock, currentSources };
}
