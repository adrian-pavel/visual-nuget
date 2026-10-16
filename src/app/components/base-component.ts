import { Component, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { Subscription } from 'rxjs';

@Component({
    template: '',
    changeDetection: ChangeDetectionStrategy.Eager,
    standalone: false
})
export class BaseComponent implements OnDestroy {
  protected subscriptions: Subscription = new Subscription();

  ngOnDestroy(): void {
    if (this.subscriptions) {
      this.subscriptions.unsubscribe();
    }
  }
}
