export interface AnalyticsSummary {
  totalUsers: number;
  activeUsers: number;
  totalCompletions: number;
  totalPointsAwarded: number;
  totalPointsRedeemed: number;
  totalCourses: number;
}

export interface EngagementPoint {
  date: string;
  completions: number;
  points: number;
  redemptions: number;
}

export interface TopCourse {
  id: string;
  title: string;
  status: string;
  completions: number;
  enrolledUsers: number;
  pointsGenerated: number;
  lessonCount: number;
}

export type AdoptionStageKey = 'eligible' | 'started' | 'completers';

export interface AdoptionStage {
  key: AdoptionStageKey;
  label: string;
  users: number;
  shareOfEligible: number;
}

export interface AdoptionDepartment {
  department: string;
  eligible: number;
  started: number;
  startRate: number;
}

export interface AdoptionReport {
  funnel: AdoptionStage[];
  stages: {
    eligible: number;
    started: number;
    completers: number;
  };
  lessonsPerLearner: number;
  medianDaysToFirstLesson: number | null;
  byDepartment: AdoptionDepartment[];
  blindSpot: string;
}

export interface AnalyticsData {
  summary: AnalyticsSummary;
  engagement: EngagementPoint[];
  topCourses: TopCourse[];
  adoption: AdoptionReport;
}
