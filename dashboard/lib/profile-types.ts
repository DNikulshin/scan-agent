// Дублирует src/core/profile/types.ts (агент не делит код с dashboard напрямую,
// см. паттерн dashboard/lib/notifications/* и dashboard/lib/profile-fetch.ts).

export interface HhExperienceItem {
  period: string;
  company: string;
  position: string;
  summary: string;
}
export interface HhResumePayload {
  url: string;
  title: string;
  area: string;
  salary: string;
  experience: HhExperienceItem[];
  skills: string[];
}

export interface FlPortfolioItem {
  title: string;
  description: string;
  link: string;
}
export interface FlProfilePayload {
  url: string;
  rating: number;
  reviewsCount: number;
  specializations: string[];
  portfolio: FlPortfolioItem[];
}

export interface KworkGigItem {
  title: string;
  price: string;
  reviewsCount: number;
  link: string;
}
export interface KworkProfilePayload {
  url: string;
  rating: number;
  reviewsCount: number;
  gigs: KworkGigItem[];
}

export interface FreelanceruServiceItem {
  title: string;
  description: string;
}
export interface FreelanceruProfilePayload {
  url: string;
  rating: number;
  services: FreelanceruServiceItem[];
}
