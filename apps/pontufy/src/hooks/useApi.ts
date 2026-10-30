import useSWR, { mutate } from 'swr';
import { useStore } from '@/store/useStore';

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) {
    const info = await r.json().catch(() => ({}));
    const error = new Error(info.error || `Request failed with status ${r.status}`);
    (error as Error & { status?: number }).status = r.status;
    throw error;
  }
  return r.json();
};

export function useCourses(page = 1, limit = 12) {
  return useSWR(`/api/courses?page=${page}&limit=${limit}`, fetcher, {
    revalidateOnFocus: false,
    fallbackData: { data: [], total: 0, page: 1, limit: 12, totalPages: 0 },
  });
}

export function useCourse(id: string) {
  return useSWR(id ? `/api/courses/${id}` : null, fetcher, {
    shouldRetryOnError: false,
  });
}

export function useEnrolledCourses() {
  return useSWR('/api/courses/enrolled', fetcher, {
    revalidateOnFocus: false,
    fallbackData: [],
  });
}

export function useRewards(page = 1, limit = 12, category?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (category) params.set('category', category);
  return useSWR(`/api/rewards?${params}`, fetcher, {
    revalidateOnFocus: false,
    fallbackData: { data: [], total: 0, page: 1, limit: 12, totalPages: 0 },
  });
}

export function usePointsHistory() {
  return useSWR('/api/users/me/history', fetcher, {
    revalidateOnFocus: false,
    fallbackData: [],
  });
}

export async function triggerLessonCompletion(
  lessonId: string,
  coursePayload?: {
    courseId: string;
    courseTitle: string;
    courseDescription?: string;
    lessons: { id: string; title: string; type: string; contentUrl?: string; points: number }[];
  },
): Promise<{
  success: boolean;
  newBalance?: number;
  alreadyCompleted?: boolean;
  queued?: boolean;
  message?: string;
  error?: string;
}> {
  const res = await fetch('/api/lessons/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lessonId, coursePayload }),
  }).catch(() => null);

  if (!res) {
    return { success: false, error: 'Sem conexão.' };
  }

  const data = await res.json();
  if (data.success && data.newBalance !== undefined) {
    useStore.getState().setPointsBalance(data.newBalance);
    mutate('/api/users/me');
    mutate('/api/users/me/history');
    mutate('/api/courses/enrolled');
  }
  return data;
}

export async function triggerRewardRedemption(rewardId: string): Promise<{
  success: boolean;
  newBalance?: number;
  affiliateUrl?: string;
  message?: string;
  error?: string;
}> {
  const res = await fetch('/api/rewards/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rewardId }),
  });
  const data = await res.json();
  if (data.success && data.newBalance !== undefined) {
    useStore.getState().setPointsBalance(data.newBalance);
    mutate('/api/users/me');
    mutate('/api/users/me/history');
    mutate('/api/rewards');
  }
  return data;
}
