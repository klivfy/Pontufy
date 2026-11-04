import { Play, Coins } from 'lucide-react';
import Link from 'next/link';

export default function CourseRow({ title, courses }: { title: string; courses: any[] }) {
  return (
    <div className="px-8 md:px-16 mb-10">
      <h2 className="text-base sm:text-lg font-bold text-md-on-surface mb-4 tracking-tight">{title}</h2>

      <div className="flex gap-2 sm:gap-3 overflow-x-auto hide-scrollbar pb-6 -mx-4 px-4">
        {courses.map((course) => (
          <Link
            href={`/player/${course.id}`}
            key={course.id}
            className="flex-none w-[180px] sm:w-[220px] group cursor-pointer block"
          >
            <div className="relative aspect-video rounded-sm overflow-hidden transition-all duration-300 ease-out group-hover:scale-110 group-hover:z-10 group-hover:shadow-2xl group-hover:shadow-black/80">
              <img
                src={course.thumbnail}
                alt={course.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {/* Hover overlay */}
              <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center">
                <div className="w-11 h-11 rounded-full bg-md-surface-container-lowest flex items-center justify-center shadow-lg">
                  <Play size={18} fill="black" strokeWidth={0} className="ml-0.5" />
                </div>
              </div>
              {/* Progress bar (terciária — gamificação) */}
              {course.progress !== undefined && course.progress > 0 && (
                <div className="absolute bottom-0 left-0 w-full h-[3px] bg-md-outline">
                  <div
                    className="h-full bg-md-tertiary"
                    style={{ width: `${course.progress}%` }}
                  />
                </div>
              )}
            </div>

            <div className="mt-2 px-0.5">
              <h3 className="text-xs sm:text-sm font-semibold text-md-on-surface line-clamp-1 group-hover:text-md-on-surface transition-colors">
                {course.title}
              </h3>
              <div className="flex items-center gap-1 mt-0.5 text-[11px] text-md-tertiary font-bold">
                <Coins size={10} /> +{course.pointsReward} pts
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
