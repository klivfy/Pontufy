export default function LojaLoading() {
  return (
    <main className="pb-20 pt-8">
      <div className="max-w-[1600px] mx-auto px-8 md:px-16">
        <div className="h-8 w-56 bg-md-surface-container-high rounded mb-2 animate-pulse" />
        <div className="h-4 w-72 bg-md-surface-container-high rounded mb-8 animate-pulse" />
        <div className="h-48 bg-md-surface-container-high rounded-xl mb-8 animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-md-surface-container-lowest rounded-xl shadow-sm border border-md-outline-variant overflow-hidden">
              <div className="h-48 bg-md-surface-container-high animate-pulse" />
              <div className="p-5 space-y-3">
                <div className="h-4 bg-md-surface-container-high rounded animate-pulse" />
                <div className="h-6 w-24 bg-md-surface-container-high rounded animate-pulse" />
                <div className="h-10 bg-md-surface-container-high rounded-lg animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
