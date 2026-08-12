import officialReposData from './official_repositories.json';

export interface OfficialRepository {
  id: string;
  name: string;
  internalName: string;
  description: string;
  url: string;
  rawRepoUrl: string;
  category: 'Official' | 'Regional' | 'Anime' | 'Movies & Shows' | 'Community' | 'Compatibility';
  language: string;
  providerCount: number;
  iconUrl?: string;
  isInstalled?: boolean;
}

export const OFFICIAL_REPOSITORIES: OfficialRepository[] = officialReposData as OfficialRepository[];
