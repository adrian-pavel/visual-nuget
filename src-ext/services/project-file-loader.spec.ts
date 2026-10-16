import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';
import ProjectFileLoader from './project-file-loader';

describe('ProjectFileLoader', () => {
  it('loads resolved project inventory without MSBuild evaluations', async () => {
    const projectPath = path.resolve('workspace', 'Inventory.csproj');
    const listPackages = jest.fn().mockResolvedValue(
      JSON.stringify({
        version: 1,
        projects: [
          {
            path: projectPath,
            frameworks: [
              {
                framework: 'net8.0',
                topLevelPackages: [{ id: 'Direct.Package', resolvedVersion: '1.2.3' }],
                transitivePackages: [{ id: 'Transitive.Package', resolvedVersion: '4.5.6' }],
              },
            ],
          },
        ],
      })
    );
    const evaluate = jest.fn();

    const project = await new ProjectFileLoader(evaluate, listPackages).loadProjectInventoryAsync(projectPath);

    expect(evaluate).not.toHaveBeenCalled();
    expect(listPackages).toHaveBeenCalledTimes(1);
    expect(project).toMatchObject({
      fsPath: projectPath,
      targetFrameworks: ['net8.0'],
      packageMetadataComplete: false,
      packages: [
        expect.objectContaining({ id: 'Direct.Package', version: '1.2.3', packageLevel: 'direct' }),
        expect.objectContaining({ id: 'Transitive.Package', version: '4.5.6', packageLevel: 'transitive' }),
      ],
    });
  });

  it('starts solution package listing before project enumeration completes', async () => {
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    const projectPath = path.resolve('workspace', 'App.csproj');
    let resolveProjectPaths!: (paths: string[]) => void;
    const projectPaths = new Promise<string[]>((resolve) => {
      resolveProjectPaths = resolve;
    });
    const listSolutionPackages = jest.fn().mockResolvedValue(
      JSON.stringify({
        version: 1,
        projects: [{ path: projectPath, frameworks: [{ framework: 'net8.0', topLevelPackages: [] }] }],
      })
    );
    const loader = new ProjectFileLoader(undefined, undefined, listSolutionPackages);

    const loading = loader.loadSolutionInventoryAsync(solutionPath, projectPaths);

    expect(listSolutionPackages).toHaveBeenCalledWith(solutionPath);
    resolveProjectPaths([projectPath]);
    await expect(loading).resolves.toEqual([
      expect.objectContaining({ fsPath: projectPath, packages: [], packageMetadataComplete: false }),
    ]);
  });

  it('preserves restored PackageVersion ranges in the fast inventory', async () => {
    const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'visual-nuget-ranges-'));
    try {
      const projectPath = path.join(temporaryDirectory, 'Ranges.csproj');
      await fs.mkdir(path.join(temporaryDirectory, 'obj'), { recursive: true });
      await fs.writeFile(
        path.join(temporaryDirectory, 'obj', 'project.assets.json'),
        JSON.stringify({
          project: {
            restore: {
              projectPath,
              originalTargetFrameworks: ['net8.0'],
              centralPackageVersionsManagementEnabled: true,
            },
            frameworks: {
              'net8.0': {
                targetAlias: 'net8.0',
                dependencies: {
                  'Pinned.Package': { target: 'Package', version: '[7.0.0]', versionCentrallyManaged: true },
                  'Bounded.Package': { target: 'Package', version: '[7.0.0, 8.0.0)', versionCentrallyManaged: true },
                },
              },
            },
          },
        })
      );
      const listPackages = jest.fn().mockResolvedValue(
        JSON.stringify({
          version: 1,
          projects: [
            {
              path: projectPath,
              frameworks: [
                {
                  framework: 'net8.0',
                  topLevelPackages: [
                    { id: 'Pinned.Package', resolvedVersion: '7.0.0' },
                    { id: 'Bounded.Package', resolvedVersion: '7.5.0' },
                  ],
                },
              ],
            },
          ],
        })
      );

      const project = await new ProjectFileLoader(undefined, listPackages).loadProjectInventoryAsync(projectPath);

      expect(project.packages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'Pinned.Package',
            version: '7.0.0',
            targetFrameworkVersions: expect.arrayContaining([expect.objectContaining({ requestedVersion: '[7.0.0]' })]),
          }),
          expect.objectContaining({
            id: 'Bounded.Package',
            version: '7.5.0',
            targetFrameworkVersions: expect.arrayContaining([
              expect.objectContaining({ requestedVersion: '[7.0.0, 8.0.0)' }),
            ]),
          }),
        ])
      );
    } finally {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('reuses the initial evaluation for a single target framework', async () => {
    const projectPath = path.resolve('workspace', 'SingleTarget.csproj');
    const evaluate = jest.fn().mockResolvedValue({
      targetFramework: 'net10.0',
      managePackageVersionsCentrally: false,
      packageReferences: [],
      packageVersions: [],
    });
    const listPackages = jest.fn().mockResolvedValue(JSON.stringify({ version: 1, projects: [{ path: projectPath, frameworks: [] }] }));

    await new ProjectFileLoader(evaluate, listPackages).loadProjectAsync(projectPath);

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(listPackages).toHaveBeenCalledTimes(1);
  });

  it('evaluates multi-target frameworks concurrently with package listing', async () => {
    const projectPath = path.resolve('workspace', 'MultiTarget.csproj');
    let activeEvaluations = 0;
    let maximumActiveEvaluations = 0;
    const evaluate = jest.fn(async (_path: string, targetFramework?: string) => {
      if (!targetFramework) {
        return {
          targetFrameworks: 'net8.0;net9.0',
          managePackageVersionsCentrally: false,
          packageReferences: [],
          packageVersions: [],
        };
      }
      activeEvaluations++;
      maximumActiveEvaluations = Math.max(maximumActiveEvaluations, activeEvaluations);
      await new Promise((resolve) => setTimeout(resolve, 0));
      activeEvaluations--;
      return {
        targetFramework,
        managePackageVersionsCentrally: false,
        packageReferences: [],
        packageVersions: [],
      };
    });
    let packageListingStarted = false;
    const listPackages = jest.fn(async () => {
      packageListingStarted = true;
      return JSON.stringify({ version: 1, projects: [{ path: projectPath, frameworks: [] }] });
    });

    const project = await new ProjectFileLoader(evaluate, listPackages).loadProjectAsync(projectPath);

    expect(maximumActiveEvaluations).toBe(2);
    expect(packageListingStarted).toBe(true);
    expect(project.targetFrameworks).toEqual(['net8.0', 'net9.0']);
    expect(evaluate).toHaveBeenCalledTimes(3);
  });

  it('loads central versions, overrides, imports, and framework-specific versions from MSBuild evaluation', async () => {
    const projectPath = path.resolve(__dirname, '..', 'test-fixtures', 'cpm', 'CpmApp', 'CpmApp.csproj');
    const listPackages = jest.fn().mockResolvedValue(
      JSON.stringify({
        version: 1,
        projects: [
          {
            path: projectPath,
            frameworks: [
              {
                framework: 'net9.0',
                topLevelPackages: [
                  { id: 'Azure.Identity', resolvedVersion: '1.19.0' },
                  { id: 'Microsoft.Extensions.Http', resolvedVersion: '10.0.12' },
                  { id: 'Newtonsoft.Json', resolvedVersion: '13.0.4' },
                  { id: 'System.Memory.Data', resolvedVersion: '10.0.11' },
                  { id: 'System.Text.Json', resolvedVersion: '10.0.11' },
                  { id: 'Azure.Core', resolvedVersion: '1.62.0' },
                ],
                transitivePackages: [{ id: 'System.ClientModel', resolvedVersion: '1.15.0' }],
              },
              {
                framework: 'net10.0',
                topLevelPackages: [
                  { id: 'Azure.Identity', resolvedVersion: '1.19.0' },
                  { id: 'Microsoft.Extensions.Http', resolvedVersion: '10.0.12' },
                  { id: 'Newtonsoft.Json', resolvedVersion: '13.0.4' },
                  { id: 'System.Memory.Data', resolvedVersion: '10.0.11' },
                  { id: 'System.Text.Json', resolvedVersion: '10.0.12' },
                  { id: 'Azure.Core', resolvedVersion: '1.62.0' },
                ],
                transitivePackages: [{ id: 'System.ClientModel', resolvedVersion: '1.15.0' }],
              },
            ],
          },
        ],
      })
    );
    const project = await new ProjectFileLoader(undefined, listPackages).loadProjectAsync(projectPath);

    expect(project.targetFrameworks).toEqual(['net9.0', 'net10.0']);
    expect(project.managePackageVersionsCentrally).toBe(true);
    expect(project.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'Microsoft.Extensions.Http',
          version: '10.0.12',
          packageLevel: 'direct',
          versionSource: 'central',
          targetFrameworkVersions: expect.arrayContaining([
            expect.objectContaining({
              targetFramework: 'net9.0',
              version: '10.0.12',
              requestedVersion: '10.0.12',
              versionSource: 'central',
              centralVersionDefinitionCount: 1,
            }),
            expect.objectContaining({
              targetFramework: 'net10.0',
              version: '10.0.12',
              requestedVersion: '10.0.12',
              versionSource: 'central',
              centralVersionDefinitionCount: 1,
            }),
          ]),
        }),
        expect.objectContaining({
          id: 'Azure.Identity',
          version: '1.19.0',
          versionSource: 'central',
          versionFilePath: expect.stringMatching(/(?:^|[\\/])ImportedVersions\.props$/i),
        }),
        expect.objectContaining({
          id: 'Azure.Core',
          version: '1.62.0',
          versionSource: 'override',
        }),
        expect.objectContaining({
          id: 'System.Text.Json',
          version: 'Varies by target framework',
          packageLevel: 'direct',
          versionSource: 'central',
          targetFrameworkVersions: expect.arrayContaining([
            expect.objectContaining({ targetFramework: 'net9.0', version: '10.0.11' }),
            expect.objectContaining({ targetFramework: 'net10.0', version: '10.0.12' }),
          ]),
        }),
      ])
    );
    expect(project.packages).toContainEqual(
      expect.objectContaining({
        id: 'System.ClientModel',
        version: '1.15.0',
        packageLevel: 'transitive',
        targetFrameworkVersions: expect.arrayContaining([
          expect.objectContaining({ targetFramework: 'net9.0', packageLevel: 'transitive' }),
          expect.objectContaining({ targetFramework: 'net10.0', packageLevel: 'transitive' }),
        ]),
      })
    );
    expect(project.packageListWarning).toBeUndefined();
  }, 30_000);

  it('preserves duplicate evaluated central package definitions as ambiguous metadata', async () => {
    const projectPath = path.resolve('workspace', 'DuplicateCentral.csproj');
    const centralFilePath = path.resolve('workspace', 'Directory.Packages.props');
    const importedFilePath = path.resolve('workspace', 'ImportedVersions.props');
    const evaluate = jest.fn().mockResolvedValue({
      targetFramework: 'net8.0',
      managePackageVersionsCentrally: true,
      packageReferences: [{ identity: 'Duplicate.Package', definingProjectFullPath: projectPath }],
      packageVersions: [
        { identity: 'Duplicate.Package', version: '1.0.0', definingProjectFullPath: centralFilePath },
        { identity: 'Duplicate.Package', version: '1.1.0', definingProjectFullPath: importedFilePath },
      ],
    });
    const listPackages = jest.fn().mockResolvedValue(
      JSON.stringify({
        version: 1,
        projects: [
          {
            path: projectPath,
            frameworks: [{ framework: 'net8.0', topLevelPackages: [{ id: 'Duplicate.Package', resolvedVersion: '1.0.0' }] }],
          },
        ],
      })
    );

    const project = await new ProjectFileLoader(evaluate, listPackages).loadProjectAsync(projectPath);

    expect(project.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'Duplicate.Package',
          versionSource: 'central',
          targetFrameworkVersions: [
            expect.objectContaining({
              targetFramework: 'net8.0',
              version: '1.0.0',
              centralVersionDefinitionCount: 2,
            }),
          ],
        }),
      ])
    );
  });

  it('keeps evaluated direct packages and reports when restore graph data is unavailable', async () => {
    const projectPath = path.resolve(__dirname, '..', 'test-fixtures', 'cpm', 'CpmApp', 'CpmApp.csproj');
    const evaluation = {
      targetFrameworks: 'net9.0',
      managePackageVersionsCentrally: true,
      packageReferences: [{ identity: 'Microsoft.Extensions.Http' }],
      packageVersions: [{ identity: 'Microsoft.Extensions.Http', version: '10.0.12' }],
    };
    const project = await new ProjectFileLoader(
      async () => evaluation,
      async () => {
        throw new Error('assets file is missing');
      }
    ).loadProjectAsync(projectPath);

    expect(project.packages).toContainEqual(
      expect.objectContaining({ id: 'Microsoft.Extensions.Http', version: '10.0.12', versionSource: 'central' })
    );
    expect(project.packageListWarning).toContain('assets file is missing');
  });
});
