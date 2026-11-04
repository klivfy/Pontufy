const STORAGE_KEY = 'pontufy:generated-courses';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface CachedCourse {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: string;
  cachedAt: number;
  /**
   * A3 — quiz do curso, já em objeto (JSON nativo no banco). O cache guarda o
   * mesmo formato do servidor para que o player não precise decidir entre
   * "string para parsear" e "objeto pronto".
   */
  quizJson?: unknown;
  lessons: Array<{
    id: string;
    title: string;
    type: string;
    pointsAssigned: number;
    contentUrl: string | null;
  }>;
}

export function saveCourse(course: CachedCourse): void {
  try {
    const existing = getCachedCourses();
    const updated = [course, ...existing.filter((c) => c.id !== course.id)].slice(0, 50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  } catch {}
}

export function getCachedCourses(): CachedCourse[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const courses: CachedCourse[] = JSON.parse(raw);
    const now = Date.now();
    return courses.filter((c) => now - c.cachedAt < MAX_AGE_MS);
  } catch {
    return [];
  }
}

export function reconcileWithApi(apiIds: Set<string>): void {
  try {
    const local = getCachedCourses();
    const remaining = local.filter((c) => !apiIds.has(c.id));
    if (remaining.length !== local.length) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(remaining));
    }
  } catch {}
}
