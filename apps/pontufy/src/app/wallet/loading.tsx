export default function WalletLoading() {
  return (
    <main className="pb-20 pt-8">
      <div className="max-w-[1000px] mx-auto px-6 md:px-8">
        <div className="h-8 w-56 bg-md-surface-container-high rounded mb-2 animate-pulse" />
        <div className="h-4 w-80 bg-md-surface-container-high rounded mb-8 animate-pulse" />
        <div className="bg-md-surface-container-lowest rounded-xl shadow-sm border border-md-outline-variant p-8 mb-8 animate-pulse">
          <div className="h-12 w-40 bg-md-surface-container-high rounded mb-2" />
          <div className="h-6 w-24 bg-md-surface-container-high rounded" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 bg-md-surface-container-high rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    </main>
  );
}
