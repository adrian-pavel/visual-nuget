import * as path from 'path';
import { Project, ProjectLoadFailure, Solution } from '../../src-common/models/project';
import ProjectFileLoader from './project-file-loader';
import { executeDotnet } from './dotnet-cli';

type ProjectLoader = Pick<ProjectFileLoader, 'loadProjectAsync'> &
  Partial<Pick<ProjectFileLoader, 'loadSolutionInventoryAsync'>>;
export type SolutionProjectLister = (solutionFilePath: string) => Promise<string>;

export interface SolutionLoadProgress {
  completed: number;
  total: number;
  message?: string;
}

const supportedProjectExtensions = new Set(['.csproj', '.vbproj', '.fsproj']);
const maxConcurrentProjectLoads = 2;

function runSolutionList(solutionFilePath: string): Promise<string> {
  return executeDotnet(['sln', solutionFilePath, 'list'], path.dirname(solutionFilePath), `Project enumeration for "${solutionFilePath}"`);
}

function parseProjectPaths(output: string): string[] {
  if (/^\s*No projects found in (the )?solution\.?\s*$/im.test(output)) {
    return [];
  }

  const lines = output.split(/\r?\n/);
  const separatorIndex = lines.findIndex((line) => /^-{3,}\s*$/.test(line));
  if (separatorIndex < 0) {
    throw new Error(`Could not parse project list returned for the solution: ${output.trim()}`);
  }

  return lines
    .slice(separatorIndex + 1)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default class SolutionLoader {
  public constructor(
    private readonly projectLoader: ProjectLoader = new ProjectFileLoader(),
    private readonly listProjects: SolutionProjectLister = runSolutionList
  ) {}

  public async loadSolutionAsync(
    solutionFilePath: string,
    onProgress?: (progress: SolutionLoadProgress) => void
  ): Promise<Solution> {
    const fullPath = path.resolve(solutionFilePath);
    const listedProjectsPromise = this.listProjects(fullPath).then((output) => {
      const unsupportedProjects: string[] = [];
      const supportedPaths: string[] = [];
      for (const listedPath of parseProjectPaths(output)) {
        const projectPath = path.resolve(path.dirname(fullPath), listedPath);
        if (!supportedProjectExtensions.has(path.extname(projectPath).toLowerCase())) {
          unsupportedProjects.push(projectPath);
          continue;
        }
        supportedPaths.push(projectPath);
      }
      return { supportedPaths, unsupportedProjects };
    });
    const inventoryPromise = this.projectLoader.loadSolutionInventoryAsync?.(
      fullPath,
      listedProjectsPromise.then(({ supportedPaths }) => supportedPaths)
    ).then(
      (projects) => ({ projects }),
      (error: unknown) => ({ error })
    );
    const { supportedPaths, unsupportedProjects } = await listedProjectsPromise;
    const loadFailures: ProjectLoadFailure[] = [];

    if (supportedPaths.length === 0) {
      return {
        name: path.basename(fullPath, path.extname(fullPath)),
        fsPath: fullPath,
        projects: [],
        unsupportedProjects,
        loadFailures: [],
      };
    }

    if (this.projectLoader.loadSolutionInventoryAsync) {
      onProgress?.({
        completed: 0,
        total: supportedPaths.length,
        message: `Loading package inventory for ${supportedPaths.length} solution projects...`,
      });
      try {
        if (!inventoryPromise) {
          throw new Error('Solution inventory loading is unavailable.');
        }
        const inventoryResult = await inventoryPromise;
        if ('error' in inventoryResult) {
          throw inventoryResult.error;
        }
        onProgress?.({ completed: supportedPaths.length, total: supportedPaths.length });
        return {
          name: path.basename(fullPath, path.extname(fullPath)),
          fsPath: fullPath,
          projects: inventoryResult.projects,
          unsupportedProjects,
          loadFailures: [],
        };
      } catch (error) {
        onProgress?.({
          completed: 0,
          total: supportedPaths.length,
          message: `Solution-wide package listing failed (${errorMessage(error)}); loading projects individually...`,
        });
      }
    }

    const projectsByIndex: Array<Project | undefined> = new Array(supportedPaths.length);
    onProgress?.({ completed: 0, total: supportedPaths.length });
    let nextIndex = 0;
    let completed = 0;

    const loadNextProject = async (): Promise<void> => {
      while (nextIndex < supportedPaths.length) {
        const index = nextIndex++;
        const projectPath = supportedPaths[index];
        try {
          projectsByIndex[index] = await this.projectLoader.loadProjectAsync(projectPath);
        } catch (error) {
          loadFailures.push({
            projectPath,
            message: errorMessage(error),
          });
        } finally {
          completed++;
          onProgress?.({ completed, total: supportedPaths.length });
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(maxConcurrentProjectLoads, supportedPaths.length) }, () => loadNextProject())
    );

    return {
      name: path.basename(fullPath, path.extname(fullPath)),
      fsPath: fullPath,
      projects: projectsByIndex.filter((project): project is Project => project !== undefined),
      unsupportedProjects,
      loadFailures,
    };
  }
}
