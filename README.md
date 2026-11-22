# Faro

Visor en español para leer la [Base de Datos Nacional de Subvenciones](https://www.infosubvenciones.es) a partir del volcado abierto de [Jaime Gómez-Obregón](https://github.com/JaimeObregon/subvenciones).

No sustituye al portal oficial. Sirve para buscar, filtrar y cruzar el extracto que ese repositorio publicó cuando la BDNS todavía no dejaba descargar el conjunto completo.

## Qué hay en los datos de origen

El repositorio upstream está **archivado** (nota de octubre de 2025). La licencia del repositorio es **GPL-3.0**. Los ficheros de datos viven en `files/` y son CSV comprimidos, **sin cabecera** (las columnas están documentadas en `db/mongodb/data/`):

| Fichero | Tamaño comprimido | Contenido |
| --- | --- | --- |
| `convocatorias.csv.gz` | 22 MB | 350.078 convocatorias (24 jun 2008 – 25 mar 2022) |
| `juridicas_1.csv.gz` | 74 MB | Concesiones a personas jurídicas |
| `juridicas_2.csv.gz` | 72 MB | Resto de concesiones a personas jurídicas |

Entre los dos ficheros de concesiones se leen 3.810.368 filas y quedan **3.794.474** identificadores distintos (unos 16.000 se repiten y se conserva la última copia). Cubren del 1 ene 2018 al 24 mar 2022. Hay **894.548** beneficiarios con NIF. El índice SQLite ocupa unos 4,9 GB.

No hay JSON, SQL ni Parquet. No hay ficheros de personas físicas: el README de origen habla de 10,5 millones de concesiones, pero en `main` solo están las de personas jurídicas. El volcado es una foto, no una serie que se actualice: los CSV entraron con el scrape de 2022 (registros sobre todo de 2014 a marzo de 2022) y los commits de 2025 solo tocan documentación.

Columnas útiles de convocatorias: identificador interno, código BDNS, marca MRR, administración, departamento, órgano, fecha de registro, título, URL de las bases. No hay plazo de solicitud, comunidad autónoma ni sector.

Columnas útiles de concesiones: identificador, convocatoria, organismo, título, aplicación presupuestaria, fecha, beneficiario (NIF + nombre), importe, instrumento y ayuda equivalente.

## Arquitectura

El comprimido son ~175 MB y, ya en claro, varios millones de filas. Eso no debe viajar al navegador: una búsqueda o un filtro devolvería cientos de megas y el gráfico del panel no puede agregar esa tabla en el cliente.

Faro hace otra cosa:

1. `pipeline/build_index.py` descarga los tres gzip (o reutiliza `data/raw/` si ya están), los lee en streaming y construye `data/bdns.sqlite`.
2. El índice lleva FTS5 (títulos, organismos, nombres y NIF), índices para los filtros y tablas ya agregadas para el panel.
3. Next.js lee esa SQLite **en el servidor** con `node:sqlite` (viene con Node 22, sin servicio aparte). Cada vista pide una página de 20 filas.

SQLite encaja mejor aquí que DuckDB-WASM o un Parquet en el cliente: el patrón es filtrar, ordenar y paginar, no un análisis ad hoc, y un solo fichero se despliega con la aplicación. Las agregaciones del panel se calculan una vez en el pipeline para que la portada no recorra la tabla de concesiones.

El script enriquece tres campos que el CSV no trae, y la interfaz los marca como estimados:

- **Territorio.** Cruce del nombre de la administración con los municipios del INE (copia en `pipeline/vendor/municipios.csv`), las provincias y alias como `ESTADO`, `DIPUTACIÓN PROV. DE …` o `CABILDO INSULAR DE …`. Lo que no casa queda en «No determinada». La administración del Estado no se reparte por comunidad.
- **Sector.** Palabras del título (educación, vivienda, empleo…). No es la finalidad oficial de la BDNS.
- **Tipo de beneficiario.** Letra del NIF (`B` sociedad limitada, `G` asociación, `P` corporación local…).

## Limitaciones

- No se puede saber qué convocatorias están abiertas hoy: no hay fecha de inicio ni de fin del plazo. La vista «Abiertas ahora» lista las registradas en los 60 días anteriores al cierre del volcado y enlaza con la [ficha oficial](https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/), que sí publica el plazo.
- No hay personas físicas. Las concesiones del volcado empiezan en 2018 aunque haya convocatorias desde 2008.
- Cerca del 1,4 % de las convocatorias queda en «No determinada»: homónimos (Torrent está en Girona y en Valencia) y nombres que el padrón no resuelve. Los bilingües con barra (`ELCHE/ELX`, `ALCOY/ALCOI`) sí se asignan.
- Los importes de garantías y préstamos no son una entrega de dinero. El panel abre en «Solo subvenciones» y permite sumar todos los instrumentos.
- El beneficiario se agrupa por NIF. Sin NIF, por el nombre normalizado.
- La foto termina en 2022. Volver a lanzar el pipeline vuelve a bajar los mismos ficheros mientras el repositorio archivado no cambie. La BDNS oficial, desde la renovación del portal, ya ofrece descarga; este proyecto no la mezcla con el volcado de Obregón.

## Arranque

Hace falta Node.js 22 y Python 3.10 o superior. El pipeline solo usa la biblioteca estándar.

```bash
pnpm install
pnpm data
pnpm dev
```

La aplicación queda en [http://127.0.0.1:43123](http://127.0.0.1:43123).

`pnpm data` descarga los CSV en `data/raw/` (no se versionan) y escribe `data/bdns.sqlite`. Si los gzip ya están y pesan más de 1 MB, no los vuelve a bajar. Para forzar la descarga, borra `data/raw/`.

La base se puede apuntar a otra ruta con `BDNS_DB=/ruta/bdns.sqlite`.

Comprobar el código del pipeline sin construir el índice:

```bash
python3 pipeline/build_index.py --self-check
```

## Producción

```bash
pnpm data
pnpm build
pnpm start
```

`pnpm start` escucha en el puerto 43123. Hace falta el fichero SQLite al lado del proceso: no es un sitio estático.

Imagen Docker (descarga el volcado y construye el índice durante el build):

```bash
docker build -t faro .
docker run --rm -p 43123:43123 faro
```

## Actualizar desde el repositorio de origen

```bash
rm -rf data/raw data/bdns.sqlite
pnpm data
```

Las URL están fijas en `pipeline/build_index.py` y apuntan a `raw.githubusercontent.com/JaimeObregon/subvenciones/main/files/`. Un cambio en esos ficheros se incorpora al reconstruir el índice. No hay cron ni versión incremental: el upstream no publica diffs.

## Créditos

- Volcado y código del repositorio de origen: Jaime Gómez-Obregón y quienes contribuyeron a [JaimeObregon/subvenciones](https://github.com/JaimeObregon/subvenciones), licencia GPL-3.0.
- Datos de fondo: Base de Datos Nacional de Subvenciones, Ministerio de Hacienda, [infosubvenciones.es](https://www.infosubvenciones.es).
- Municipios de apoyo para estimar la comunidad autónoma: relación INE redistribuida por [codeforspain/ds-organizacion-administrativa](https://github.com/codeforspain/ds-organizacion-administrativa), incluida en `pipeline/vendor/municipios.csv`.
