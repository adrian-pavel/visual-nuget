import * as path from 'path';
import { Solution } from '../../src-common/models/project';

interface SolutionCacheEntry {
  solution?: Solution;
  pending?: Promise<Solution>;
  byteLength: number;
}

export default class SessionSolutionCache {
  private static readonly maxEntries = 8;
  private static readonly maxEntryBytes = 16 * 1024 * 1024;
  private static readonly maxBytes = 32 * 1024 * 1024;
  private readonly entries = new Map<string, SolutionCacheEntry>();
  private totalBytes = 0;

  public constructor(private readonly shouldCache: (solution: Solution) => boolean = () => true) {}

  public get(solutionFilePath: string): Solution | undefined {
    const key = this.createKey(solutionFilePath);
    const entry = this.entries.get(key);
    if (!entry?.solution) {
      return undefined;
    }

    this.touch(key, entry);
    return entry.solution;
  }

  public invalidate(solutionFilePath: string): boolean {
    const key = this.createKey(solutionFilePath);
    if (!this.entries.has(key)) {
      return false;
    }

    this.delete(key);
    return true;
  }

  public get entryCount(): number {
    return this.entries.size;
  }

  public getOrLoad(solutionFilePath: string, load: () => Promise<Solution>): Promise<Solution> {
    const key = this.createKey(solutionFilePath);
    const existing = this.entries.get(key);
    if (existing?.solution) {
      this.touch(key, existing);
      return Promise.resolve(existing.solution);
    }
    if (existing?.pending) {
      this.touch(key, existing);
      return existing.pending;
    }

    const entry: SolutionCacheEntry = { byteLength: 0 };
    this.entries.set(key, entry);
    const pending = this.loadAndStore(key, entry, load);
    entry.pending = pending;
    return pending;
  }

  public clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private async loadAndStore(key: string, entry: SolutionCacheEntry, load: () => Promise<Solution>): Promise<Solution> {
    try {
      const solution = await load();
      if (this.entries.get(key) === entry) {
        this.store(key, entry, solution);
      }
      return solution;
    } catch (error) {
      if (this.entries.get(key) === entry) {
        this.delete(key);
      }
      throw error;
    }
  }

  private store(key: string, entry: SolutionCacheEntry, solution: Solution): void {
    if (solution.loadFailures.length > 0 || !this.shouldCache(solution)) {
      this.delete(key);
      return;
    }

    const serialized = JSON.stringify(solution);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength > SessionSolutionCache.maxEntryBytes) {
      this.delete(key);
      return;
    }

    entry.solution = solution;
    entry.pending = undefined;
    entry.byteLength = byteLength;
    this.totalBytes += byteLength;
    this.evictToLimits();
  }

  private createKey(solutionFilePath: string): string {
    const normalizedPath = path.normalize(path.resolve(solutionFilePath));
    return process.platform === 'win32' ? normalizedPath.toLowerCase() : normalizedPath;
  }

  private touch(key: string, entry: SolutionCacheEntry): void {
    this.entries.delete(key);
    this.entries.set(key, entry);
  }

  private delete(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) {
      return;
    }
    this.entries.delete(key);
    this.totalBytes -= entry.byteLength;
  }

  private evictToLimits(): void {
    while (this.entries.size > SessionSolutionCache.maxEntries || this.totalBytes > SessionSolutionCache.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      this.delete(oldestKey);
    }
  }
}
