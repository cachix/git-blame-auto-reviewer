export interface BlameInfo {
  commit: string;
  author: string;
  authorEmail: string;
  lineNumber: number;
}

export interface AuthorStats {
  linesChanged: number;
  filesAffected: number;
  percentageOfChanges: number;
  commits: Set<string>;
}

export interface PotentialReviewer {
  username: string;
  stats: AuthorStats;
}

export interface ActionInputs {
  token: string;
  maxReviewers: number;
  threshold: number;
  ignoreAuthors: string[];
  lookbackDays: number;
}
