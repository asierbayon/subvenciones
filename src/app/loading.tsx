const Loading = () => (
  <p className="xp-loading" role="status">
    <span>Cargando datos…</span>
    <span className="xp-progress xp-progress-busy" aria-hidden="true">
      <span />
    </span>
  </p>
);

export default Loading;
