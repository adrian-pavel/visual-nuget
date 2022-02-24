import { Component, HostListener } from '@angular/core';

import { Message } from './models/message';
import { PackageSource } from './models/package-source';
import { Project } from './models/project';
import { PackageManagerService } from './services/package-manager.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  constructor(private packageManager: PackageManagerService) {}

  @HostListener('window:message', ['$event'])
  MessageFromExtension(event: MessageEvent<Message>) {
    const message = event.data;
    if (message.type === 'project') {
      this.packageManager.changeCurrentProject(message.data as Project);
    } else if (message.type === 'sources') {
      this.packageManager.changeCurrentSources(message.data as PackageSource[]);
    }
  }
}
