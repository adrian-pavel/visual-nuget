import { PackageSource } from './package-source';
import { Project } from './project';

export interface ExtensionMessage {
  type: string;
  data: Project | PackageSource[];
}
