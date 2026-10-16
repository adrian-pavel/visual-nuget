import * as path from 'path';
import { Solution } from '../../src-common/models/project';
import SessionSolutionCache from './session-solution-cache';

function solution(solutionPath: string, name = 'Sample'): Solution {
  return {
    name,
    fsPath: solutionPath,
    projects: [],
    unsupportedProjects: [],
    loadFailures: [],
  };
}

describe('SessionSolutionCache', () => {
  test('reuses a completed inventory for a normalized solution path', async () => {
    const cache = new SessionSolutionCache();
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    const loader = jest.fn().mockResolvedValue(solution(solutionPath));

    await cache.getOrLoad(solutionPath, loader);
    const reopened = await cache.getOrLoad(path.join(path.dirname(solutionPath), '.', path.basename(solutionPath)), loader);

    expect(loader).toHaveBeenCalledTimes(1);
    expect(reopened).toEqual(solution(solutionPath));
  });

  test('coalesces concurrent loads for the same solution', async () => {
    const cache = new SessionSolutionCache();
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    let resolveLoad!: (value: Solution) => void;
    const load = jest.fn(
      () =>
        new Promise<Solution>((resolve) => {
          resolveLoad = resolve;
        })
    );

    const first = cache.getOrLoad(solutionPath, load);
    const second = cache.getOrLoad(solutionPath, load);

    expect(load).toHaveBeenCalledTimes(1);
    resolveLoad(solution(solutionPath));
    await expect(Promise.all([first, second])).resolves.toEqual([solution(solutionPath), solution(solutionPath)]);
  });

  test('does not repopulate a cache entry after invalidation during a load', async () => {
    const cache = new SessionSolutionCache();
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    let resolveLoad!: (value: Solution) => void;
    const loading = cache.getOrLoad(
      solutionPath,
      () =>
        new Promise<Solution>((resolve) => {
          resolveLoad = resolve;
        })
    );

    cache.clear();
    resolveLoad(solution(solutionPath));
    await loading;

    expect(cache.get(solutionPath)).toBeUndefined();
  });

  test('does not cache rejected or incomplete inventory results', async () => {
    const cache = new SessionSolutionCache();
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    const failure = new Error('inventory failed');
    await expect(cache.getOrLoad(solutionPath, () => Promise.reject(failure))).rejects.toBe(failure);

    const incomplete: Solution = {
      ...solution(solutionPath),
      loadFailures: [{ projectPath: path.resolve('workspace', 'App.csproj'), message: 'evaluation failed' }],
    };
    const loader = jest.fn().mockResolvedValue(incomplete);
    await cache.getOrLoad(solutionPath, loader);
    await cache.getOrLoad(solutionPath, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('does not cache a result outside the watched workspace', async () => {
    const cache = new SessionSolutionCache(() => false);
    const solutionPath = path.resolve('workspace', 'Sample.slnx');
    const loader = jest.fn().mockResolvedValue(solution(solutionPath));

    await cache.getOrLoad(solutionPath, loader);
    await cache.getOrLoad(solutionPath, loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  test('evicts the least recently used solution when the entry limit is exceeded', async () => {
    const cache = new SessionSolutionCache();
    const paths = Array.from({ length: 9 }, (_, index) => path.resolve('workspace', `Solution${index}.slnx`));

    for (const solutionPath of paths.slice(0, 8)) {
      await cache.getOrLoad(solutionPath, () => Promise.resolve(solution(solutionPath)));
    }
    await cache.getOrLoad(paths[0], () => Promise.resolve(solution(paths[0])));
    await cache.getOrLoad(paths[8], () => Promise.resolve(solution(paths[8])));

    expect(cache.get(paths[0])).toEqual(solution(paths[0]));
    expect(cache.get(paths[1])).toBeUndefined();
    expect(cache.get(paths[8])).toEqual(solution(paths[8]));
  });
});
