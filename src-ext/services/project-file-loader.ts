import * as path from 'path';
import * as fs from 'fs/promises';
import { InstalledPackage, PackageLevel, PackageVersionSource, Project, TargetFrameworkPackageVersion } from '../../src-common/models/project';
import { executeDotnet } from './dotnet-cli';

interface MsbuildItem {
  identity: string;
  version?: string;
  versionOverride?: string;
  definingProjectFullPath?: string;
  condition?: string;
}

export interface ProjectEvaluation {
  targetFramework?: string;
  targetFrameworks?: string;
  managePackageVersionsCentrally: boolean;
  packageReferences: MsbuildItem[];
  packageVersions: MsbuildItem[];
}

export type ProjectEvaluationRunner = (projectFilePath: string, targetFramework?: string) => Promise<ProjectEvaluation>;

interface PackageListEntry {
  projectPath: string;
  id: string;
  targetFramework: string;
  version: string;
  packageLevel: 'direct' | 'transitive';
}

interface PackageListProject {
  path: string;
  frameworks: Array<{
    framework: string;
    topLevelPackages?: Array<{ id: string; resolvedVersion?: string }>;
    transitivePackages?: Array<{ id: string; resolvedVersion?: string }>;
  }>;
}

interface PackageListDocument {
  projects: PackageListProject[];
}

interface AssetsDependency {
  version?: string;
  versionCentrallyManaged?: boolean;
  versionOverride?: string;
}

interface AssetsFramework {
  targetAlias?: string;
  dependencies?: Record<string, AssetsDependency>;
}

interface ProjectAssets {
  project?: {
    restore?: {
      projectPath?: string;
      originalTargetFrameworks?: string[];
      centralPackageVersionsManagementEnabled?: boolean;
    };
    frameworks?: Record<string, AssetsFramework>;
  };
}

export type ProjectPackageLister = (projectFilePath: string) => Promise<string>;
export type SolutionPackageLister = (solutionFilePath: string) => Promise<string>;

interface EvaluationJson {
  Properties?: Record<string, unknown>;
  Items?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readItems(items: unknown, itemName: string): MsbuildItem[] {
  if (items === undefined) {
    return [];
  }
  if (!Array.isArray(items)) {
    throw new Error(`MSBuild returned an invalid ${itemName} item list.`);
  }

  return items.map((item: unknown, index: number) => {
    if (!isRecord(item) || typeof item['Identity'] !== 'string') {
      throw new Error(`MSBuild returned an invalid ${itemName} item at index ${index}.`);
    }

    return {
      identity: item['Identity'],
      version: readString(item['Version']),
      versionOverride: readString(item['VersionOverride']),
      definingProjectFullPath: readString(item['DefiningProjectFullPath']),
      condition: readString(item['Condition']),
    };
  });
}

function runPackageList(projectFilePath: string): Promise<string> {
  return executeDotnet(
    ['list', 'package', '--include-transitive', '--format', 'json', '--no-restore', '--project', projectFilePath],
    path.dirname(projectFilePath),
    `Package listing for "${projectFilePath}"`
  );
}

function runSolutionPackageList(solutionFilePath: string): Promise<string> {
  return executeDotnet(
    ['list', solutionFilePath, 'package', '--include-transitive', '--format', 'json', '--no-restore'],
    path.dirname(solutionFilePath),
    `Package listing for solution "${solutionFilePath}"`
  );
}

function packageEntriesFromDocument(document: PackageListDocument): PackageListEntry[] {
  const entries: PackageListEntry[] = [];
  for (const project of document.projects) {
    for (const framework of project.frameworks) {
      for (const [key, packageLevel] of [
        ['topLevelPackages', 'direct'],
        ['transitivePackages', 'transitive'],
      ] as const) {
        const packages = key === 'topLevelPackages' ? framework.topLevelPackages : framework.transitivePackages;
        for (const packageItem of packages ?? []) {
          const version = packageItem.resolvedVersion;
          if (!version) {
            continue;
          }
          entries.push({
            projectPath: project.path,
            id: packageItem.id,
            targetFramework: framework.framework,
            version,
            packageLevel,
          });
        }
      }
    }
  }
  return entries;
}

function parsePackageListDocument(output: string): PackageListDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse dotnet package list output: ${detail}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed['projects'])) {
    throw new Error('dotnet package list returned an invalid project list.');
  }

  const projects: PackageListProject[] = [];
  for (const project of parsed['projects']) {
    if (!isRecord(project) || typeof project['path'] !== 'string' || !Array.isArray(project['frameworks'])) {
      throw new Error('dotnet package list returned an invalid project entry.');
    }
    const frameworks: PackageListProject['frameworks'] = [];
    for (const framework of project['frameworks']) {
      if (!isRecord(framework) || typeof framework['framework'] !== 'string') {
        throw new Error('dotnet package list returned an invalid framework entry.');
      }
      frameworks.push({
        framework: framework['framework'],
        topLevelPackages: readPackageListItems(framework['topLevelPackages'], 'topLevelPackages'),
        transitivePackages: readPackageListItems(framework['transitivePackages'], 'transitivePackages'),
      });
    }
    projects.push({ path: project['path'], frameworks });
  }
  return { projects };
}

function readPackageListItems(value: unknown, property: string): Array<{ id: string; resolvedVersion?: string }> {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`dotnet package list returned an invalid ${property} list.`);
  }
  return value.map((item: unknown) => {
    if (!isRecord(item) || typeof item['id'] !== 'string') {
      throw new Error(`dotnet package list returned an invalid ${property} entry.`);
    }
    return {
      id: item['id'],
      resolvedVersion: readString(item['resolvedVersion']),
    };
  });
}

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath).toLowerCase();
}

async function readProjectAssets(projectFilePath: string): Promise<ProjectAssets | undefined> {
  const assetsPath = path.join(path.dirname(projectFilePath), 'obj', 'project.assets.json');
  let contents: string;
  try {
    contents = await fs.readFile(assetsPath, 'utf8');
  } catch (error) {
    if (isRecord(error) && error['code'] === 'ENOENT') {
      return undefined;
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents) as unknown;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not parse project assets at "${assetsPath}": ${detail}`);
  }
  if (!isRecord(parsed) || !isRecord(parsed['project'])) {
    return undefined;
  }
  const project = parsed['project'];
  const restore = isRecord(project['restore']) ? project['restore'] : undefined;
  const restoredProjectPath = readString(restore?.['projectPath']);
  if (restoredProjectPath && normalizeProjectPath(restoredProjectPath) !== normalizeProjectPath(projectFilePath)) {
    return undefined;
  }
  const frameworks = isRecord(project['frameworks']) ? project['frameworks'] : undefined;
  return {
    project: {
      restore: {
        projectPath: restoredProjectPath,
        originalTargetFrameworks: Array.isArray(restore?.['originalTargetFrameworks'])
          ? restore?.['originalTargetFrameworks'].filter((item): item is string => typeof item === 'string')
          : undefined,
        centralPackageVersionsManagementEnabled:
          typeof restore?.['centralPackageVersionsManagementEnabled'] === 'boolean'
            ? restore['centralPackageVersionsManagementEnabled']
            : undefined,
      },
      frameworks: frameworks as Record<string, AssetsFramework> | undefined,
    },
  };
}

function applyAssetsMetadata(project: Project, assets: ProjectAssets | undefined): void {
  const assetsProject = assets?.project;
  project.packageMetadataComplete = false;
  if (!assetsProject) {
    return;
  }
  project.managePackageVersionsCentrally = assetsProject.restore?.centralPackageVersionsManagementEnabled;
  if (assetsProject.restore?.originalTargetFrameworks?.length) {
    project.targetFrameworks = assetsProject.restore.originalTargetFrameworks;
  }

  const dependencies = new Map<string, AssetsDependency>();
  Object.entries(assetsProject.frameworks ?? {}).forEach(([framework, value]) => {
    if (!isRecord(value)) {
      return;
    }
    const targetAlias = readString(value['targetAlias']) ?? framework;
    const frameworkDependencies = isRecord(value['dependencies']) ? value['dependencies'] : {};
    Object.entries(frameworkDependencies).forEach(([packageId, value]) => {
      if (!isRecord(value)) {
        return;
      }
      dependencies.set(`${targetAlias.toLowerCase()}|${packageId.toLowerCase()}`, {
        version: readString(value['version']),
        versionCentrallyManaged: typeof value['versionCentrallyManaged'] === 'boolean' ? value['versionCentrallyManaged'] : undefined,
        versionOverride: readString(value['versionOverride']),
      });
    });
  });

  project.packages.forEach((installedPackage) => {
    const sources = new Set<PackageVersionSource>();
    installedPackage.targetFrameworkVersions?.forEach((frameworkVersion) => {
      if (frameworkVersion.packageLevel !== 'direct') {
        return;
      }
      const dependency = dependencies.get(
        `${frameworkVersion.targetFramework.toLowerCase()}|${installedPackage.id.toLowerCase()}`
      );
      if (!dependency) {
        return;
      }
      frameworkVersion.requestedVersion = dependency.versionOverride ?? dependency.version;
      frameworkVersion.versionSource = dependency.versionOverride
        ? 'override'
        : dependency.versionCentrallyManaged
          ? 'central'
          : 'project';
      sources.add(frameworkVersion.versionSource);
    });
    if (sources.size > 0) {
      installedPackage.versionSource = sources.size === 1 ? Array.from(sources)[0] : 'mixed';
    }
  });
}

function createInventoryProject(projectFilePath: string, entries: PackageListEntry[], assets: ProjectAssets | undefined): Project {
  const packages = mergeResolvedPackages([], entries);
  const targetFrameworks = Array.from(new Set(entries.map((entry) => entry.targetFramework)));
  const project: Project = {
    name: path.basename(projectFilePath),
    fsPath: path.resolve(projectFilePath),
    packages,
    targetFrameworks,
    packageMetadataComplete: false,
  };
  applyAssetsMetadata(project, assets);
  return project;
}

async function loadInventoryProject(projectFilePath: string, entries: PackageListEntry[]): Promise<Project> {
  let assets: ProjectAssets | undefined;
  let assetsWarning: string | undefined;
  try {
    assets = await readProjectAssets(projectFilePath);
  } catch (error) {
    assetsWarning = error instanceof Error ? error.message : String(error);
  }
  const project = createInventoryProject(projectFilePath, entries, assets);
  project.packageListWarning = assetsWarning;
  return project;
}

function runMsbuildEvaluation(projectFilePath: string, targetFramework?: string): Promise<ProjectEvaluation> {
  const args = [
    'msbuild',
    projectFilePath,
    '-nologo',
    '-property:Configuration=Debug',
    '-getProperty:TargetFramework,TargetFrameworks,ManagePackageVersionsCentrally',
    '-getItem:PackageReference,PackageVersion',
  ];
  if (targetFramework) {
    args.push(`-property:TargetFramework=${targetFramework}`);
  }

  return executeDotnet(args, path.dirname(projectFilePath), `MSBuild evaluation for "${projectFilePath}"`).then((stdout) => {
    let result: unknown;
    try {
      result = JSON.parse(stdout) as unknown;
    } catch (parseError) {
      const detail = parseError instanceof Error ? parseError.message : String(parseError);
      throw new Error(`Could not parse MSBuild evaluation output for "${projectFilePath}": ${detail}`);
    }

    if (!isRecord(result)) {
      throw new Error(`MSBuild returned an invalid evaluation result for "${projectFilePath}".`);
    }
    const output = result as EvaluationJson;
    const properties = output.Properties;
    const items = output.Items;
    if (!isRecord(properties) || !isRecord(items)) {
      throw new Error(`MSBuild returned an incomplete evaluation result for "${projectFilePath}".`);
    }

    return {
      targetFramework: readString(properties['TargetFramework']),
      targetFrameworks: readString(properties['TargetFrameworks']),
      managePackageVersionsCentrally: readString(properties['ManagePackageVersionsCentrally'])?.toLowerCase() === 'true',
      packageReferences: readItems(items['PackageReference'], 'PackageReference'),
      packageVersions: readItems(items['PackageVersion'], 'PackageVersion'),
    };
  });
}

function effectivePackageVersion(
  reference: MsbuildItem,
  packageVersions: MsbuildItem[],
  targetFramework: string
): TargetFrameworkPackageVersion {
  const centralVersions = packageVersions.filter((item) => item.identity.toLowerCase() === reference.identity.toLowerCase());
  const centralVersion =
    centralVersions.find((item) => item.condition?.includes(`'$(TargetFramework)' == '${targetFramework}'`)) ??
    centralVersions.find((item) => item.condition === undefined) ??
    (centralVersions.length === 1 ? centralVersions[0] : undefined);
  const version = reference.versionOverride ?? reference.version ?? centralVersion?.version ?? '';
  let versionSource: PackageVersionSource = 'unknown';
  let versionFilePath = reference.definingProjectFullPath;

  if (reference.versionOverride) {
    versionSource = 'override';
  } else if (reference.version) {
    versionSource = 'project';
  } else if (centralVersion?.version) {
    versionSource = 'central';
    versionFilePath = centralVersion.definingProjectFullPath;
  }

  return {
    targetFramework: '',
    version,
    requestedVersion: version || undefined,
    versionSource,
    centralVersionDefinitionCount: versionSource === 'central' ? centralVersions.length : undefined,
    packageLevel: 'direct',
    condition: centralVersion?.condition ?? reference.condition,
    versionFilePath,
  };
}

function mergePackages(evaluations: ProjectEvaluation[]): InstalledPackage[] {
  const packages = new Map<string, { id: string; versions: TargetFrameworkPackageVersion[] }>();

  for (const evaluation of evaluations) {
    const referencesById = new Map<string, MsbuildItem>();
    for (const reference of evaluation.packageReferences) {
      const key = reference.identity.toLowerCase();
      const existing = referencesById.get(key);
      if (existing) {
        const existingVersion = effectivePackageVersion(existing, evaluation.packageVersions, evaluation.targetFramework ?? '').version;
        const duplicateVersion = effectivePackageVersion(reference, evaluation.packageVersions, evaluation.targetFramework ?? '').version;
        if (existingVersion !== duplicateVersion) {
          throw new Error(`Project has conflicting evaluated PackageReference entries for "${reference.identity}".`);
        }
      }
      referencesById.set(key, reference);
    }

    for (const [key, reference] of referencesById) {
      const entry = packages.get(key) ?? { id: reference.identity, versions: [] };
      const resolvedVersion = effectivePackageVersion(reference, evaluation.packageVersions, evaluation.targetFramework ?? '');
      resolvedVersion.targetFramework = evaluation.targetFramework ?? '';
      entry.versions.push(resolvedVersion);
      packages.set(key, entry);
    }
  }

  return Array.from(packages.values()).map(({ id, versions }) => {
    const uniqueVersions = new Set(versions.map((entry) => entry.version));
    const uniqueSources = new Set(versions.map((entry) => entry.versionSource));
    const uniqueFiles = new Set(versions.map((entry) => entry.versionFilePath).filter((filePath): filePath is string => filePath !== undefined));
    return {
      id,
      version: uniqueVersions.size === 1 ? versions[0].version : 'Varies by target framework',
      versionSource: uniqueSources.size === 1 ? versions[0].versionSource : 'mixed',
      packageLevel: packageLevelFor(versions),
      targetFrameworkVersions: versions,
      versionFilePath: uniqueFiles.size === 1 ? Array.from(uniqueFiles)[0] : undefined,
    };
  });
}

function packageLevelFor(versions: TargetFrameworkPackageVersion[]): PackageLevel {
  const levels = new Set<'direct' | 'transitive'>(versions.flatMap((entry) => (entry.packageLevel ? [entry.packageLevel] : [])));
  if (levels.has('direct') && levels.has('transitive')) {
    return 'mixed';
  }
  if (levels.has('direct')) {
    return 'direct';
  }
  if (levels.has('transitive')) {
    return 'transitive';
  }
  return 'unknown';
}

function validateDirectPackageListing(evaluations: ProjectEvaluation[], entries: PackageListEntry[]): void {
  const resolvedPackageIds = new Set(entries.filter((entry) => entry.packageLevel === 'direct').map((entry) => entry.id.toLowerCase()));
  const missingIds = Array.from(
    new Set(evaluations.flatMap((evaluation) => evaluation.packageReferences.map((item) => item.identity.toLowerCase())))
  ).filter((id) => !resolvedPackageIds.has(id));
  if (missingIds.length > 0) {
    throw new Error(`No resolved package data was returned for ${missingIds.join(', ')}. Restore the project to show installed versions and transitive packages.`);
  }
}

function mergeResolvedPackages(packages: InstalledPackage[], entries: PackageListEntry[]): InstalledPackage[] {
  const packagesById = new Map(packages.map((item) => [item.id.toLowerCase(), item]));
  for (const item of entries) {
    const key = item.id.toLowerCase();
    let installedPackage = packagesById.get(key);
    if (!installedPackage) {
      installedPackage = {
        id: item.id,
        version: item.version,
        versionSource: 'unknown',
        packageLevel: item.packageLevel,
        targetFrameworkVersions: [],
      };
      packagesById.set(key, installedPackage);
      packages.push(installedPackage);
    }

    const frameworkVersion = installedPackage.targetFrameworkVersions?.find(
      (entry) => entry.targetFramework.toLowerCase() === item.targetFramework.toLowerCase()
    );
    if (frameworkVersion) {
      frameworkVersion.version = item.version;
      frameworkVersion.packageLevel = item.packageLevel;
    } else {
      installedPackage.targetFrameworkVersions ??= [];
      installedPackage.targetFrameworkVersions.push({
        targetFramework: item.targetFramework,
        version: item.version,
        versionSource: installedPackage.versionSource ?? 'unknown',
        packageLevel: item.packageLevel,
        versionFilePath: installedPackage.versionFilePath,
      });
    }
  }

  return packages.map((item) => {
    const versions = item.targetFrameworkVersions ?? [];
    const uniqueVersions = new Set(versions.map((entry) => entry.version));
    item.version = uniqueVersions.size === 1 ? versions[0].version : uniqueVersions.size > 1 ? 'Varies by target framework' : item.version;
    item.packageLevel = packageLevelFor(versions);
    return item;
  });
}

export default class ProjectFileLoader {
  public constructor(
    private readonly evaluate: ProjectEvaluationRunner = runMsbuildEvaluation,
    private readonly listPackages: ProjectPackageLister = runPackageList,
    private readonly listSolutionPackages: SolutionPackageLister = runSolutionPackageList
  ) {}

  public async loadProjectInventoryAsync(projectFilePath: string): Promise<Project> {
    const fullPath = path.resolve(projectFilePath);
    const output = await this.listPackages(fullPath);
    const document = parsePackageListDocument(output);
    if (!document.projects.some((project) => normalizeProjectPath(project.path) === normalizeProjectPath(fullPath))) {
      throw new Error(`dotnet package list did not return project "${fullPath}".`);
    }
    const entries = packageEntriesFromDocument(document).filter(
      (entry) => normalizeProjectPath(entry.projectPath) === normalizeProjectPath(fullPath)
    );
    return loadInventoryProject(fullPath, entries);
  }

  public async loadSolutionInventoryAsync(
    solutionFilePath: string,
    projectFilePaths: string[] | Promise<string[]>
  ): Promise<Project[]> {
    const fullPath = path.resolve(solutionFilePath);
    const packageListPromise = this.listSolutionPackages(fullPath);
    const [output, resolvedProjectFilePaths] = await Promise.all([packageListPromise, Promise.resolve(projectFilePaths)]);
    const document = parsePackageListDocument(output);
    const projectPaths = new Set(document.projects.map((project) => normalizeProjectPath(project.path)));
    const missingProjects = resolvedProjectFilePaths.filter((projectPath) => !projectPaths.has(normalizeProjectPath(projectPath)));
    if (missingProjects.length > 0) {
      throw new Error(`dotnet package list did not return ${missingProjects.length} solution project(s): ${missingProjects.join(', ')}`);
    }

    const entriesByProject = new Map<string, PackageListEntry[]>();
    packageEntriesFromDocument(document).forEach((entry) => {
      const key = normalizeProjectPath(entry.projectPath);
      const projectEntries = entriesByProject.get(key) ?? [];
      projectEntries.push(entry);
      entriesByProject.set(key, projectEntries);
    });
    return Promise.all(
      resolvedProjectFilePaths.map((projectPath) =>
        loadInventoryProject(projectPath, entriesByProject.get(normalizeProjectPath(projectPath)) ?? [])
      )
    );
  }

  public async loadProjectAsync(projectFilePath: string): Promise<Project> {
    const fullPath = path.resolve(projectFilePath);
    const initialEvaluation = await this.evaluate(fullPath);
    const targetFrameworks = (initialEvaluation.targetFrameworks ?? initialEvaluation.targetFramework ?? '')
      .split(';')
      .map((framework) => framework.trim())
      .filter((framework) => framework.length > 0);

    const initialEvaluationCoversTargetFramework =
      targetFrameworks.length === 1 &&
      initialEvaluation.targetFramework?.toLowerCase() === targetFrameworks[0].toLowerCase();
    const evaluationsPromise =
      targetFrameworks.length === 0 || initialEvaluationCoversTargetFramework
        ? Promise.resolve([initialEvaluation])
        : Promise.all(targetFrameworks.map((targetFramework) => this.evaluate(fullPath, targetFramework)));
    const packageListPromise = this.listPackages(fullPath).then(
      (output) => ({ output }),
      (error: unknown) => ({ error })
    );
    const [evaluations, packageListResult] = await Promise.all([evaluationsPromise, packageListPromise]);

    let packages = mergePackages(evaluations);
    let packageListWarning: string | undefined;
    try {
      if ('error' in packageListResult) {
        throw packageListResult.error;
      }
      const packageList = packageEntriesFromDocument(parsePackageListDocument(packageListResult.output));
      validateDirectPackageListing(evaluations, packageList);
      packages = mergeResolvedPackages(packages, packageList);
    } catch (error) {
      packageListWarning = error instanceof Error ? error.message : String(error);
    }

    return {
      name: path.basename(fullPath),
      fsPath: fullPath,
      packages,
      targetFrameworks,
      managePackageVersionsCentrally: initialEvaluation.managePackageVersionsCentrally,
      packageMetadataComplete: true,
      packageListWarning,
    };
  }
}
