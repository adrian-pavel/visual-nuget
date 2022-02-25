import { Injectable } from '@angular/core';

@Injectable()
export class SelectionService<T> {
  private _selection = new Set<T>();

  get selected(): T[] {
    return Array.from(this._selection.values());
  }

  public get isEmpty(): boolean {
    return this._selection.size === 0;
  }

  public select(value: T): void {
    if (!this.isSelected(value)) {
      this._selection.add(value);
    }
  }

  public deselect(value: T): void {
    if (this.isSelected(value)) {
      this._selection.delete(value);
    }
  }

  public selectAll(values: T[]): void {
    values.forEach((v) => this.select(v));
  }

  public clear(): void {
    if (!this.isEmpty) {
      this._selection.forEach((v) => this.deselect(v));
    }
  }

  public isSelected(value: T): boolean {
    return this._selection.has(value);
  }

  public areAllSelected(values: T[]): boolean {
    if (this.isEmpty) {
      return false;
    }

    for (const v of values) {
      if (!this.isSelected(v)) {
        return false;
      }
    }

    return true;
  }
}
