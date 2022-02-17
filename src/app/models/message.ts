import { PackageSource } from './package-source';
import { Project } from './project';

export interface Message {
  type: string;
  data: Project | PackageSource[];
}
