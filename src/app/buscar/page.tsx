import Link from "next/link";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/format";
import { parseFilters, toQuery, type SearchParams } from "@/lib/params";
import { hasSearchTerms, searchBeneficiarios, searchConvocatorias } from "@/lib/queries";

const linkClass =
  "font-medium text-accent underline decoration-accent/30 underline-offset-4 transition-colors hover:text-accent-strong hover:decoration-accent";

const BuscarPage = async ({ searchParams }: { searchParams: Promise<SearchParams> }) => {
  const filters = parseFilters(await searchParams, "fecha");
  if (!hasSearchTerms(filters.q)) {
    return (
      <PageIntro eyebrow="Búsqueda" title="Escribe un nombre, un organismo o un código">
        <p>Usa al menos una palabra de dos letras que no sea un artículo. La caja de arriba recorre el índice local.</p>
      </PageIntro>
    );
  }

  const loaded = await guard(async () => {
    const narrowed = { ...filters, page: 1 };
    const [convocatorias, beneficiarios] = await Promise.all([
      searchConvocatorias(narrowed, 8),
      searchBeneficiarios({ ...narrowed, sort: "importe", dir: "desc" }, 8),
    ]);
    return { convocatorias, beneficiarios };
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }

  const convocatoriasHref = `/convocatorias${toQuery(filters, { page: 1, sort: "fecha", dir: "desc" })}`;
  const beneficiariosHref = `/beneficiarios${toQuery({ ...filters, sort: "importe", dir: "desc" }, { page: 1 })}`;

  return (
    <>
      <PageIntro eyebrow="Búsqueda" title={`Resultados para «${filters.q}»`}>
        <p>Coincidencias por título, organismo, nombre o NIF. Los acentos no importan.</p>
      </PageIntro>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Convocatorias</h2>
            <Link href={convocatoriasHref} className="text-sm font-medium text-accent hover:text-accent-strong hover:underline underline-offset-4">
              Ver todas
            </Link>
          </div>
          {loaded.convocatorias.rows.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {loaded.convocatorias.rows.map((row) => (
                <li key={row.id} className="px-4 py-3 text-sm transition-colors hover:bg-highlight/50">
                  <Link href={`/convocatorias/${row.codigoBdns}`} className={linkClass}>
                    {row.titulo}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    {formatDate(row.fecha)} · {row.organismo}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted">Ninguna convocatoria coincide.</p>
          )}
        </section>

        <section className="rounded-xl border border-line bg-elev p-5 shadow-2xs">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">Beneficiarios</h2>
            <Link href={beneficiariosHref} className="text-sm font-medium text-accent hover:text-accent-strong hover:underline underline-offset-4">
              Ver todos
            </Link>
          </div>
          {loaded.beneficiarios.rows.length > 0 ? (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {loaded.beneficiarios.rows.map((row) => (
                <li key={row.id} className="px-4 py-3 text-sm transition-colors hover:bg-highlight/50">
                  <Link href={`/beneficiarios/${row.id}`} className={linkClass}>
                    {row.nombre}
                  </Link>
                  <p className="mt-1 text-xs text-muted">
                    <span className="font-mono">{row.nif}</span> · <span className="tabular-nums">{formatEuro(row.importeTotal)}</span>
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-sm text-muted">Ningún beneficiario coincide.</p>
          )}
        </section>
      </div>
    </>
  );
};

export default BuscarPage;
