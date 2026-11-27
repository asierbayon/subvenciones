import Link from "next/link";
import { AlertBanner, type MethodologyItem } from "@/components/alert-banner";
import { AlertFilterForm, AlertPager } from "@/components/alert-filters";
import {
  AlertCard,
  AlertDisclosure,
  AlertEvidenceList,
  AlertMetaRow,
  AlertResultsBar,
  alertLinkClass,
} from "@/components/alert-ui";
import { ExternalLink } from "@/components/facts";
import { EmptyState, PageIntro, SetupNeeded } from "@/components/setup-needed";
import { Badge } from "@/components/ui/badge";
import { DatabaseMissingError, guard } from "@/lib/db";
import { formatEuro, formatNumber } from "@/lib/format";
import {
  listVinculos,
  parseAlertFilters,
  vinculoLabel,
  VINCULO_TIPOS,
  type AlertSearch,
  type VinculoMiembro,
} from "@/lib/registro";

const METHODOLOGY: MethodologyItem[] = [
  {
    label: "Qué agrupa",
    text: "Dos o más sociedades con NIF distinto que cobran del mismo organismo y publican en el BORME (2016–2023) al mismo administrador, socio único o domicilio.",
  },
  {
    label: "Confianza y filtros",
    text: "Solo entran sociedades con cruce de confianza alta. Se excluyen personas presentes en más de 20 empresas y domicilios en más de 12.",
  },
  {
    label: "Límites",
    text: "El BORME no incluye DNI (pueden existir homónimos) y una gestoría puede compartir domicilio con empresas sin relación entre sí.",
  },
];

const MemberRow = ({ alertId, miembro }: { alertId: number; miembro: VinculoMiembro }) => (
  <li key={`${alertId}-${miembro.beneficiarioId ?? miembro.nif}`} className="px-3.5 py-2.5 text-xs">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="min-w-0">
        {miembro.beneficiarioId ? (
          <Link href={`/beneficiarios/${miembro.beneficiarioId}`} className={alertLinkClass}>
            {miembro.nombre}
          </Link>
        ) : (
          <span className="font-semibold text-ink">{miembro.nombre}</span>
        )}
        <span className="ml-2 text-muted">
          <span className="font-mono">{miembro.nif}</span> · {formatNumber(miembro.n)}{" "}
          {miembro.n === 1 ? "ayuda" : "ayudas"}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {miembro.fuenteUrl ? <ExternalLink href={miembro.fuenteUrl}>BORME</ExternalLink> : null}
        <span className="font-semibold text-ink tabular-nums">{formatEuro(miembro.importe)}</span>
      </div>
    </div>
    {miembro.items.length > 0 ? (
      <div className="mt-2">
        <AlertDisclosure label="Ver concesiones" count={miembro.items.length}>
          <AlertEvidenceList
            items={miembro.items.map((item) => ({
              key: String(item.concesionId),
              amount: item.importe,
              date: item.fecha,
              title: item.titulo || "Concesión",
              href: `/concesiones/${item.concesionId}`,
            }))}
          />
        </AlertDisclosure>
      </div>
    ) : null}
  </li>
);

const RegistroPage = async ({ searchParams }: { searchParams: Promise<AlertSearch> }) => {
  const filters = parseAlertFilters(await searchParams);
  const loaded = await guard(async () => {
    try {
      return await listVinculos(filters);
    } catch (error) {
      if (error instanceof DatabaseMissingError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "";
      if (message.includes("no such table")) {
        return null;
      }
      throw error;
    }
  });
  if (loaded === "missing") {
    return <SetupNeeded />;
  }
  if (!loaded) {
    return (
      <PageIntro eyebrow="Registro mercantil" title="Falta calcular este indicador">
        <p>
          Ejecuta <code>python3 pipeline/borme.py run</code>. Hace falta el índice de concesiones y el extracto del
          BORME. El paso es opcional.
        </p>
      </PageIntro>
    );
  }

  return (
    <>
      <PageIntro eyebrow="Registro mercantil" title="Quién está detrás de las sociedades">
        <p>Beneficiarios con distinto NIF que cobran del mismo organismo y comparten persona o domicilio en el BORME.</p>
      </PageIntro>
      <AlertBanner methodology={METHODOLOGY}>
        Dos administradores pueden ser homónimos y una gestoría puede agrupar domicilios sin que exista concertación.
      </AlertBanner>
      <AlertFilterForm
        action="/alertas/registro"
        filters={filters}
        ccaa={loaded.ccaa}
        anios={loaded.anios}
        organismos={loaded.organismos}
        tipos={VINCULO_TIPOS}
      />
      <AlertResultsBar
        total={loaded.total}
        shown={loaded.alerts.length}
        page={filters.page}
        pageSize={loaded.pageSize}
        singular="grupo"
        plural="grupos"
      />
      {loaded.alerts.length === 0 ? (
        <EmptyState>Ningún indicador con estos filtros.</EmptyState>
      ) : (
        <ol className="grid gap-4">
          {loaded.alerts.map((alert) => {
            const previewMembers = alert.miembros.slice(0, 3);
            const remainingMembers = alert.miembros.slice(3);

            return (
              <li key={alert.id}>
                <AlertCard
                  tone="terra"
                  badges={
                    <>
                      <Badge tone="terra">{vinculoLabel(alert.tipo)}</Badge>
                      <Badge tone="accent">{formatNumber(alert.nBeneficiarios)} sociedades</Badge>
                    </>
                  }
                  title={alert.etiqueta}
                  subtitle={<AlertMetaRow items={[alert.organismo, alert.ccaa, alert.anio || "sin año"]} />}
                  metric={formatEuro(alert.importe)}
                  metricLabel="Importe combinado"
                  footer={
                    <>
                      {remainingMembers.length > 0 ? (
                        <AlertDisclosure
                          label={
                            remainingMembers.length === 1
                              ? "Mostrar 1 sociedad restante"
                              : `Mostrar las ${formatNumber(remainingMembers.length)} sociedades restantes`
                          }
                          count={remainingMembers.length}
                        >
                          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-subtle/35">
                            {remainingMembers.map((miembro) => (
                              <MemberRow
                                key={`${alert.id}-${miembro.beneficiarioId ?? miembro.nif}`}
                                alertId={alert.id}
                                miembro={miembro}
                              />
                            ))}
                          </ul>
                        </AlertDisclosure>
                      ) : null}
                      <AlertDisclosure label="Explicación detallada">
                        <p className="text-xs leading-relaxed text-muted">{alert.motivo}</p>
                      </AlertDisclosure>
                    </>
                  }
                >
                  {previewMembers.length > 0 ? (
                    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-subtle/35">
                      {previewMembers.map((miembro) => (
                        <MemberRow
                          key={`${alert.id}-${miembro.beneficiarioId ?? miembro.nif}`}
                          alertId={alert.id}
                          miembro={miembro}
                        />
                      ))}
                    </ul>
                  ) : null}
                </AlertCard>
              </li>
            );
          })}
        </ol>
      )}
      <AlertPager path="/alertas/registro" filters={filters} total={loaded.total} pageSize={loaded.pageSize} />
    </>
  );
};

export default RegistroPage;
