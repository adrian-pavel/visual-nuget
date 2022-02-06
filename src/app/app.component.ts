import { Component, HostListener, OnInit } from '@angular/core';
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
  title = 'visual-nuget';

  constructor(private packageManager: PackageManagerService) {}

  @HostListener('window:message', ['$event'])
  MessageFromExtension(event: MessageEvent) {
    const message = event.data as Message;
    if (message.type === 'project') {
      this.packageManager.setProject(message.data as Project);
    } else if (message.type === 'sources') {
      this.packageManager.setSources(message.data as PackageSource[]);
    }
  }
}
