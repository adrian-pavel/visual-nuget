import * as path from 'path';
import { performance } from 'node:perf_hooks';
import { Project } from '../../src-common/models/project';
import ProjectFileLoader from './project-file-loader';
import SolutionLoader, { SolutionProjectLister } from './solution-loader';
import { executeDotnet } from './dotnet-cli';

describe('SolutionLoader', () => {
  it('loads supported projects from an SLNX list and reports unsupported projects', async () => {
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    const projectPath = path.resolve('workspace', 'src', 'App.csproj');
    const project: Project = {
      name: 'App.csproj',
      fsPath: projectPath,
      packages: [],
    };
    const projectLoader: Pick<ProjectFileLoader, 'loadProjectAsync'> = {
      loadProjectAsync: jest.fn().mockResolvedValue(project),
    };
    const listProjects: SolutionProjectLister = jest.fn().mockResolvedValue(
      ['Project(s)', '----------', 'src\\App.csproj', 'tools\\Legacy.proj', ''].join('\n')
    );
    const loader = new SolutionLoader(projectLoader, listProjects);

    const solution = await loader.loadSolutionAsync(solutionPath);

    expect(listProjects).toHaveBeenCalledWith(solutionPath);
    expect(projectLoader.loadProjectAsync).toHaveBeenCalledWith(projectPath);
    expect(solution.projects).toEqual([project]);
    expect(solution.unsupportedProjects).toEqual([path.resolve('workspace', 'tools', 'Legacy.proj')]);
    expect(solution.loadFailures).toEqual([]);
  });

  it('loads all solution package inventory in one bulk request', async () => {
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    const projectPath = path.resolve('workspace', 'src', 'App.csproj');
    const project: Project = { name: 'App.csproj', fsPath: projectPath, packages: [] };
    let resolveProjectList!: (projectList: string) => void;
    const projectLoader: ProjectLoaderForTest = {
      loadProjectAsync: jest.fn(),
      loadSolutionInventoryAsync: jest.fn().mockResolvedValue([project]),
    };
    const listProjects = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveProjectList = resolve;
        })
    );
    const loader = new SolutionLoader(projectLoader, listProjects);
    const progress: Array<{ completed: number; total: number; message?: string }> = [];

    const loading = loader.loadSolutionAsync(solutionPath, (state) => progress.push(state));

    expect(projectLoader.loadSolutionInventoryAsync).toHaveBeenCalledTimes(1);
    const inventoryProjectPaths = (projectLoader.loadSolutionInventoryAsync as jest.Mock).mock.calls[0][1] as Promise<string[]>;
    resolveProjectList(['Project(s)', '----------', 'src\\App.csproj'].join('\n'));
    const solution = await loading;

    await expect(inventoryProjectPaths).resolves.toEqual([projectPath]);
    expect(listProjects).toHaveBeenCalledWith(solutionPath);
    expect(projectLoader.loadProjectAsync).not.toHaveBeenCalled();
    expect(solution.projects).toEqual([project]);
    expect(progress[0].message).toContain('Loading package inventory');
    expect(progress[progress.length - 1]).toEqual({ completed: 1, total: 1 });
  });

  it('falls back to per-project loading when bulk package listing is unavailable', async () => {
    const projectPath = path.resolve('App.csproj');
    const project: Project = { name: 'App.csproj', fsPath: projectPath, packages: [] };
    const projectLoader: ProjectLoaderForTest = {
      loadProjectAsync: jest.fn().mockResolvedValue(project),
      loadSolutionInventoryAsync: jest.fn().mockRejectedValue(new Error('unsupported solution listing')),
    };
    const loader = new SolutionLoader(
      projectLoader,
      async () => ['Project(s)', '----------', 'App.csproj'].join('\n')
    );
    const progress: Array<{ completed: number; total: number; message?: string }> = [];

    const solution = await loader.loadSolutionAsync('Sample.slnx', (state) => progress.push(state));

    expect(projectLoader.loadProjectAsync).toHaveBeenCalledWith(projectPath);
    expect(solution.projects).toEqual([project]);
    expect(progress.some((state) => state.message?.includes('loading projects individually'))).toBe(true);
  });

  it('returns an empty project list for an empty solution', async () => {
    const loader = new SolutionLoader(undefined, async () => 'No projects found in the solution.');

    await expect(loader.loadSolutionAsync('Empty.slnx')).resolves.toMatchObject({ projects: [], unsupportedProjects: [], loadFailures: [] });
  });

  type ProjectLoaderForTest = Pick<ProjectFileLoader, 'loadProjectAsync'> &
    Partial<Pick<ProjectFileLoader, 'loadSolutionInventoryAsync'>>;

  it('continues loading other projects when one project cannot be evaluated', async () => {
    const projectLoader: Pick<ProjectFileLoader, 'loadProjectAsync'> = {
      loadProjectAsync: jest.fn().mockRejectedValueOnce(new Error('MSBuild evaluation failed')).mockResolvedValueOnce({
        name: 'Good.csproj',
        fsPath: path.resolve('Good.csproj'),
        packages: [],
      }),
    };
    const loader = new SolutionLoader(projectLoader, async () => ['Project(s)', '----------', 'Bad.csproj', 'Good.csproj'].join('\n'));

    const solution = await loader.loadSolutionAsync('Sample.slnx');

    expect(solution.projects.map((project) => project.name)).toEqual(['Good.csproj']);
    expect(solution.loadFailures).toEqual([{ projectPath: path.resolve('Bad.csproj'), message: 'MSBuild evaluation failed' }]);
  });

  it('loads projects with bounded concurrency and reports completion progress', async () => {
    let activeLoads = 0;
    let maximumActiveLoads = 0;
    const projectLoader: Pick<ProjectFileLoader, 'loadProjectAsync'> = {
      loadProjectAsync: jest.fn(async (projectPath: string) => {
        activeLoads++;
        maximumActiveLoads = Math.max(maximumActiveLoads, activeLoads);
        await new Promise((resolve) => setTimeout(resolve, 0));
        activeLoads--;
        return { name: path.basename(projectPath), fsPath: projectPath, packages: [] };
      }),
    };
    const listedProjects = Array.from({ length: 9 }, (_, index) => `Project${index}.csproj`);
    const loader = new SolutionLoader(projectLoader, async () => ['Project(s)', '----------', ...listedProjects].join('\n'));
    const progress: Array<{ completed: number; total: number }> = [];

    const solution = await loader.loadSolutionAsync('Sample.slnx', (state) => progress.push(state));

    expect(maximumActiveLoads).toBe(2);
    expect(solution.projects.map((project) => project.name)).toEqual(listedProjects);
    expect(progress[progress.length - 1]).toEqual({ completed: 9, total: 9 });
  });

  it('uses the dotnet SLNX project list for the CPM fixture', async () => {
    const solutionPath = path.resolve(__dirname, '..', 'test-fixtures', 'cpm', 'CpmFixture.slnx');
    const actualProjectLoader = new ProjectFileLoader();
    const timings = { projectEnumerationMs: [] as number[], packageInventoryMs: [] as number[], totalMs: [] as number[] };
    const timedProjectLoader = {
      loadProjectAsync: actualProjectLoader.loadProjectAsync.bind(actualProjectLoader),
      loadSolutionInventoryAsync: async (filePath: string, projectPaths: string[]) => {
        const startedAt = performance.now();
        try {
          return await actualProjectLoader.loadSolutionInventoryAsync(filePath, projectPaths);
        } finally {
          timings.packageInventoryMs.push(performance.now() - startedAt);
        }
      },
    };
    const listProjects: SolutionProjectLister = async (filePath) => {
      const startedAt = performance.now();
      try {
        return await executeDotnet(
          ['sln', filePath, 'list'],
          path.dirname(filePath),
          `Project enumeration for "${filePath}"`
        );
      } finally {
        timings.projectEnumerationMs.push(performance.now() - startedAt);
      }
    };
    const loader = new SolutionLoader(timedProjectLoader, listProjects);
    let projectCount = 0;

    for (let open = 0; open < 2; open++) {
      const startedAt = performance.now();
      const solution = await loader.loadSolutionAsync(solutionPath);
      timings.totalMs.push(performance.now() - startedAt);
      projectCount = solution.projects.length;
      expect(solution.projects.map((project) => path.basename(project.fsPath))).toEqual(['CpmApp.csproj']);
      expect(solution.projects[0].packages.find((item) => item.id === 'Microsoft.Extensions.Http')?.version).toBe('10.0.12');
      expect(solution.projects[0].managePackageVersionsCentrally).toBe(true);
      expect(solution.projects[0].packages.find((item) => item.id === 'Microsoft.Extensions.Http')?.versionSource).toBe('central');
      expect(solution.projects[0].packages.find((item) => item.id === 'Azure.Core')?.versionSource).toBe('override');
    }
    console.info(
      `[Visual NuGet timing] CpmFixture (${projectCount} project): ` +
        `project-list=${timings.projectEnumerationMs.map((ms) => ms.toFixed(1)).join('/')}ms, ` +
        `package-inventory=${timings.packageInventoryMs.map((ms) => ms.toFixed(1)).join('/')}ms, ` +
        `total=${timings.totalMs.map((ms) => ms.toFixed(1)).join('/')}ms (first/reopen)`
    );
  }, 30_000);
});
