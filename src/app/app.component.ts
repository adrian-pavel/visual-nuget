import { Component, HostListener } from '@angular/core';

import { ExtensionMessage } from '../../src-common/models/extension-message';
import { PackageSource } from '../../src-common/models/package-source';
import { Project } from '../../src-common/models/project';
import { PackageManagerService } from './services/package-manager.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
})
export class AppComponent {
  constructor(private packageManager: PackageManagerService) {}

  @HostListener('window:message', ['$event'])
  MessageFromExtension(event: MessageEvent<ExtensionMessage>) {
    const message = event.data;
    if (message.type === 'project') {
      this.packageManager.changeCurrentProject(message.data as Project);
    } else if (message.type === 'sources') {
      this.packageManager.changeCurrentSources(message.data as PackageSource[]);
    }
  }
}
