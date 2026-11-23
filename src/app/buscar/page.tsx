import Link from "next/link";
import { PageIntro, SetupNeeded } from "@/components/setup-needed";
import { guard } from "@/lib/db";
import { formatDate, formatEuro } from "@/lib/format";
import { parseFilters, toQuery, type SearchParams } from "@/lib/params";
import { hasSearchTerms, searchBeneficiarios, searchConvocatorias } from "@/lib/queries";

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
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="xp-group">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="xp-heading">Convocatorias</h2>
            <Link href={convocatoriasHref} className="xp-link font-normal">
              Ver todas
            </Link>
          </div>
          <ul className="xp-inset-list">
            {loaded.convocatorias.rows.map((row) => (
              <li key={row.id} className="px-3 py-2">
                <Link href={`/convocatorias/${row.codigoBdns}`} className="xp-link">
                  {row.titulo}
                </Link>
                <p className="mt-1 text-muted">
                  {formatDate(row.fecha)} · {row.organismo}
                </p>
              </li>
            ))}
          </ul>
          {loaded.convocatorias.rows.length === 0 ? <p className="text-muted">Ninguna convocatoria coincide.</p> : null}
        </section>
        <section className="xp-group">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h2 className="xp-heading">Beneficiarios</h2>
            <Link href={beneficiariosHref} className="xp-link font-normal">
              Ver todos
            </Link>
          </div>
          <ul className="xp-inset-list">
            {loaded.beneficiarios.rows.map((row) => (
              <li key={row.id} className="px-3 py-2">
                <Link href={`/beneficiarios/${row.id}`} className="xp-link">
                  {row.nombre}
                </Link>
                <p className="mt-1 text-muted">
                  {row.nif} · {formatEuro(row.importeTotal)}
                </p>
              </li>
            ))}
          </ul>
          {loaded.beneficiarios.rows.length === 0 ? <p className="text-muted">Ningún beneficiario coincide.</p> : null}
        </section>
      </div>
    </>
  );
};

export default BuscarPage;
