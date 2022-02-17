export interface PackageSource {
  name: string;
  url: string;
  authorizationHeader: string | undefined;
}

export const NUGET_ORG: PackageSource = {
  name: 'nuget.org',
  url: 'https://api.nuget.org/v3/index.json',
  authorizationHeader: undefined,
};
