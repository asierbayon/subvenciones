const Loading = () => (
  <div className="mx-auto my-12 flex max-w-xs flex-col items-center gap-3 text-center" role="status">
    <span className="text-sm font-medium text-muted">Cargando datos…</span>
    <span className="h-1.5 w-full overflow-hidden rounded-full bg-subtle" aria-hidden="true">
      <span className="loading-bar-fill block h-full rounded-full bg-accent" />
    </span>
  </div>
);

export default Loading;
