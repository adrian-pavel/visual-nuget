export interface ApiIndexResponse {
  resources: ApiResource[];
}

export interface ApiResource {
  '@id': string;
  '@type': string;
}
