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

### Columnas que trae el volcado

Los CSV no llevan cabecera. Los nombres salen de `db/mongodb/data/*-headers.csv` en el repositorio de origen. Posición 0 es la primera columna.

**Convocatorias** (13 columnas, 350.078 filas, ninguna truncada):

| # | Nombre en el origen | Qué es en la práctica |
| --- | --- | --- |
| 0 | `id` | Identificador interno del scrape. Es la clave con la que la concesión apunta a la convocatoria (`id_convocatoria`). |
| 1 | `codigo_bdns` | Código BDNS. Único en este volcado. Construye la ficha oficial `…/convocatorias/{codigo}`. |
| 2 | `MRR` | `SI` / `NO`. Solo 494 convocatorias marcadas SI. |
| 3 | `administracion` | Administración convocante, a menudo la comunidad, el municipio o `ESTADO`. |
| 4 | `departamento` | Órgano o departamento. Es el «organismo» que muestra Faro cuando viene informado. |
| 5 | `organo` | Vacío en 295.015 filas. Cuando viene, es una unidad más fina (ICEX, fundaciones estatales…). |
| 6 | `fecha_registro` | Fecha de registro en la BDNS (`dd/mm/aaaa`). No es el plazo de solicitud. |
| 7 | `titulo_convocatoria` | Título. |
| 8 | `url_bases_regul` | URL de las bases, a veces vacía o no oficial. |
| 9 | `titulo_cooficial` | Título en otra lengua. Vacío casi siempre (17.938 informados). |
| 10 | `colDesconocida1` | Siempre vacía. |
| 11 | `colDesconocida2` | Siempre `350078`, el número de filas del fichero. No es un dato de la ayuda. |
| 12 | `colDesconocida3` | Contador de fila del scrape (1…350078). |

No hay columna de procedimiento, de concesión directa, de plazo, de comunidad autónoma, de sector ni de reintegros.

**Concesiones a personas jurídicas** (17 columnas). En muestras de 80.000 filas de cada gzip todas tenían 17 campos.

| # | Nombre en el origen | Qué es en la práctica |
| --- | --- | --- |
| 0 | `id` | Identificador de la concesión. |
| 1 | `id_convocatoria` | Apunta a `convocatorias.id`. En el índice no queda ninguna concesión huérfana. |
| 2 | `administracion` | Igual que en la convocatoria. |
| 3 | `departamento` | Organismo que concede. |
| 4 | `organo` | A menudo vacío. |
| 5 | `titulo_convocatoria` | Título, repetido desde la convocatoria. |
| 6 | `url_bases_regul` | URL de bases. |
| 7 | `apli_presupuestaria` | Aplicación presupuestaria, texto libre. |
| 8 | `fecha_concesion` | Fecha de concesión. |
| 9 | `beneficiario` | NIF (letra + 7 dígitos + control) y, tras un espacio, el nombre. En la primera parte del fichero el NIF venía siempre. |
| 10 | `importe` | Importe en euros, número simple (`500`, `10000`). |
| 11 | `instrumento` | Solo cinco valores: subvención dineraria (2.953.663), garantía (825.892), préstamo (12.774), otros instrumentos (1.283), ventaja fiscal (862). |
| 12 | `ayuda_equivalente` | Subvención equivalente. En las entregas dinerarias coincide con el importe; en garantías y préstamos puede no serlo. |
| 13 | `detalles` | En las muestras solo vale `0` o `1` (casi siempre `0`). No es un reintegro ni un texto. |
| 14 | `codigo_bdns` | Mismo código BDNS de la convocatoria. |
| 15 | `valor_desconocido` | Identificador de tanda del scrape (`10413793`, `10435022`). No describe la ayuda. |
| 16 | `id_interna` | Secuencia dentro de la tanda. |

No hay columna de reintegro, de sanción, de tipo de procedimiento ni de «concesión directa». La vía directa solo se puede aproximar leyendo el título (`CONCESIÓN DIRECTA` aparece en 2.744 convocatorias; `NOMINATIV` en 53.554). Esa lectura es un proxy, no un campo de la BDNS. El enlace concesión → convocatoria sí está, por `id_convocatoria` y por `codigo_bdns`.

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

- No se puede saber qué convocatorias están abiertas hoy: no hay fecha de inicio ni de fin del plazo. La ficha oficial sí lo publica: [infosubvenciones.es](https://www.infosubvenciones.es/bdnstrans/GE/es/convocatorias/).
- No hay personas físicas. Las concesiones del volcado empiezan en 2018 aunque haya convocatorias desde 2008.
- Cerca del 1,4 % de las convocatorias queda en «No determinada»: homónimos (Torrent está en Girona y en Valencia) y nombres que el padrón no resuelve. Los bilingües con barra (`ELCHE/ELX`, `ALCOY/ALCOI`) sí se asignan.
- Los importes de garantías y préstamos no son una entrega de dinero. El panel abre en «Solo subvenciones» y permite sumar todos los instrumentos.
- El beneficiario se agrupa por NIF. Sin NIF, por el nombre normalizado.
- La foto termina en 2022. Volver a lanzar el pipeline vuelve a bajar los mismos ficheros mientras el repositorio archivado no cambie. La BDNS oficial, desde la renovación del portal, ya ofrece descarga; este proyecto no la mezcla con el volcado de Obregón.

## Alertas

Los indicadores se calculan encima del índice, sin volver a leer los CSV:

```bash
python3 pipeline/alerts.py fraccionamiento
```

Son señales para revisar expedientes, no pruebas de un incumplimiento. El fraccionamiento exige el mismo NIF privado y el mismo organismo, convocatorias distintas, importes no idénticos, y una mediana por encima del percentil 75 de lo que ese organismo concede a entidades privadas. La banda es el 90–100 % de 15.000 €, 40.000 € o 200.000 € en 90 días. La regla de suma exige piezas de al menos 50.000 € que juntas queden entre 190.000 € y 200.000 €. Si el mismo organismo repite el patrón con más de tres NIF en el mismo mes, se trata como un programa y se descarta. Esos umbrales son el contrato menor de servicios de la LCSP, el de obras, y el de minimis del Reglamento (UE) 1407/2013. No son topes de la Ley General de Subvenciones. Quedan fuera los pagos de una sola convocatoria, los NIF de administraciones (P, Q, S), las universidades y los bloques de más de cuatro concesiones. La lista se ordena por una puntuación de cercanía al umbral, número de convocatorias y rareza para ese organismo.

```bash
python3 pipeline/alerts.py concentracion
```

La concentración usa solo subvenciones dinerarias. El HHI es la suma de los cuadrados de la cuota de cada beneficiario. Se marca un organismo con al menos 20 concesiones y 4 beneficiarios si el HHI llega a 0,25 o si el mayor perceptor se lleva la mitad o más. 0,25 es la escala que el Departamento de Justicia de EE. UU. llama «muy concentrado» en un mercado; aquí es una regla de lectura, no una infracción. Los ganadores recurrentes que se listan son entidades privadas, no universidades, con al menos cuatro años y un millón de euros acumulados. El resto de repeticiones anuales queda fuera de la lista.

```bash
python3 pipeline/alerts.py calendario
```

El calendario compara, para cada organismo, los 45 días previos a una elección con los 45 anteriores; diciembre con la media del resto de ese año; y los 45 días posteriores a un cambio de gobierno (2 jun 2018 y 8 ene 2020) con los 45 previos. Las elecciones autonómicas solo se miran en su comunidad; las generales, en todas. El relevo de beneficiarios es un índice de Jaccard inferior a 0,30 entre dos años seguidos, con al menos 15 perceptores en cada uno.

```bash
python3 pipeline/alerts.py estadistica
```

Benford usa la desviación media absoluta de Nigrini: por encima de 0,015, con al menos 200 subvenciones y un rango de importes de al menos cien veces. Los múltiplos de 1.000 € se marcan solo si superan en 20 puntos la cuota global del volcado (en este extracto, cerca del 19 % de las subvenciones de 1.000 € o más). Un atípico está a 3,5 desviaciones del logaritmo del importe respecto de las demás subvenciones del mismo organismo y del mismo tipo de beneficiario.

```bash
python3 pipeline/alerts.py directa
```

No hay columna de procedimiento ni de reintegro, así que no se fabrica una «concesión directa» oficial. El sustituto cuenta títulos que dicen «concesión directa», «concessió directa» o «nominativ» y ordena los organismos por esa cuota. Es una pista de texto, no el campo que la BDNS usa por dentro.

```bash
python3 pipeline/borme.py run
```

El cruce con el BORME es un paso aparte. `pnpm data` no lo lanza, y el índice se puede construir y consultar sin él. Hace falta el índice ya generado. El script baja los sumarios de la [API de datos abiertos del BOE](https://www.boe.es/datosabiertos/api/api.php) entre el 1 ene 2016 y el 31 dic 2023, lee el XML de la sección primera (actos inscritos) y deja un extracto en `data/borme/` que no se versiona. Por defecto abre 4 descargas en paralelo y espera 0,12 s entre el inicio de cada petición. Si el servidor responde 429, alarga la pausa. El proceso se puede reanudar. La reutilización sigue las [condiciones del BOE](https://www.boe.es/informacion/aviso_legal/index.php): la interfaz cita «Basado en datos de la Agencia Estatal Boletín Oficial del Estado» y enlaza el anuncio.

No se usan los PDF ni libreBORME / bormeparser. Esos proyectos ya parsean el boletín, pero a partir del PDF y con dependencias que no caben en un pipeline de biblioteca estándar. El XML oficial de la sección A, también para los años históricos, basta para constitución, capital, domicilio, nombramientos y disolución.

El BORME identifica a la sociedad por el nombre y la hoja registral. El NIF aparece en muy pocos anuncios. El emparejamiento:

1. Pasa el nombre a mayúsculas, quita tildes y puntuación.
2. Quita al final la forma social (`SOCIEDAD LIMITADA`, `S.L.`, `S.L.U.`, `S.A.`, …), de modo que el anuncio y la BDNS coincidan aunque escriban la forma distinto.
3. Si esa clave, en todo el extracto, apunta a una sola hoja y a un solo beneficiario, y el nombre tiene al menos dos palabras distintivas (o una sola palabra larga), la confianza es **alta**.
4. Si la hoja es única pero el nombre es corto o genérico (`INVERSIONES`, `SERVICIOS`, un topónimo), la confianza es **media**.
5. Si varias hojas o varios NIF comparten la clave, no se asigna ficha: queda **ambigua**.
6. Un NIF escrito en el anuncio junto a la etiqueta CIF/NIF desempata: si coincide, la confianza pasa a alta; si contradice al beneficiario, el cruce se descarta.

Las señales de sociedad usan confianza alta o media, y lo dicen en el texto. Los administradores compartidos viven en `/alertas/registro` (la ruta `/alertas/vinculos` es la de cargos públicos). Solo usan confianza alta. El mismo paso escribe `borme_admins` (NIF, nombre y cargo, sin fechas de nombramiento) para ese otro indicador. Una persona entra si el nombre tiene al menos tres tokens; un administrador que es otra sociedad entra por su denominación normalizada. Se dejan fuera las personas que aparecen en más de 20 sociedades y los domicilios compartidos por más de 12: suelen ser homónimos o gestorías.

Reglas, todas sobre subvenciones dinerarias:

- **nueva_capital.** Constitución como mucho 365 días antes de una ayuda de al menos 10.000 €, y capital publicado de hasta 3.100 € (el mínimo legal de 3.000 y los redondeos que salen en el boletín).
- **nueva_disuelta.** Constitución en esos 365 días, una ayuda de al menos 10.000 €, y disolución, extinción o cierre provisional en los 730 días posteriores a esa ayuda.
- **importe_capital.** Capital de hasta 3.100 € y una ayuda de al menos 10.000 € y de al menos diez veces ese capital.
- **disuelta_pronto.** Disolución o extinción en los 540 días posteriores a una ayuda de al menos 10.000 €.
- **administrador / socio / domicilio.** Dos o más NIF distintos cobran del mismo organismo y publican la misma persona o el mismo domicilio.

`python3 pipeline/borme.py report` imprime las tasas de cruce. `python3 pipeline/borme.py --self-check` prueba el parser con un extracto corto de un anuncio real, sin red.

### Qué salió de un pase 2016-2023

El pase cubre los 2.086 días laborables del 1 ene 2016 al 31 dic 2023 (1.984 con sección primera y 102 sin boletín). Son 4.227.767 anuncios de sociedad y 1.890.203 hojas. El 99,6 % de los anuncios trae hoja registral. Solo 13.211 (el 0,3 %) publican un NIF junto a la etiqueta CIF o NIF: el cruce es, en la práctica, por nombre. El extracto ocupa unos 2,4 GB en `data/borme/borme.sqlite` y no se versiona. El índice de la aplicación, ya con estas tablas, queda en unos 5,4 GB.

De 490.241 sociedades con NIF A, B, C o D y un nombre utilizable:

| Confianza | Sociedades | Cuota |
| --- | ---: | ---: |
| Alta | 236.773 | 48,3 % |
| Media | 38.283 | 7,8 % |
| Débil, no se usa en las señales | 6.034 | 1,2 % |
| Ambigua, varias hojas o varios NIF | 9.152 | 1,9 % |
| Sin anuncio en la ventana | 199.999 | 40,8 % |

La confianza alta o media suma el 56,1 %. El resto son sobre todo sociedades que no publicaron ningún acto entre 2016 y 2023: el BORME de esos años no es el censo histórico del registro.

En una muestra aleatoria de 20 cruces de confianza alta, los 20 nombres normalizados coinciden con el de la hoja. Cuatro anuncios se abrieron además en el XML oficial (constitución con capital de 3.000 €, extinción por fusión, disolución voluntaria) y el texto leído es el de esa sociedad. Eso mide el acierto del emparejamiento por nombre, no descarta un homónimo que no hubiera publicado nada en la ventana.

Indicadores, con el aviso de que no son pruebas:

| Señal | Casos |
| --- | ---: |
| Constituida hace poco y capital mínimo | 1.141 |
| Constituida y cerrada en poco tiempo | 24 |
| Ayuda grande frente al capital | 3.089 |
| Cierre poco después de la ayuda | 728 |
| Mismo administrador | 13.511 |
| Mismo socio único | 282 |
| Mismo domicilio | 1.571 |

Ejemplos reales del pase:

- VILLADANGOS INTERMODAL SL (B24725194) se constituye el 6 feb 2019 con 3.000 € y socio único NETWORK STEEL RESOURCES SA. En 2019 cobra del organismo de fomento de Castilla y León. Anuncio `BORME-A-2019-41-24`.
- FERROATLÁNTICA DE SABÓN SLU y FERROATLÁNTICA DE BOO SLU se constituyen el 13 ago 2019, cobran del Ministerio de Industria y el 13 oct 2021 el BORME publica su extinción por fusión en FERROATLÁNTICA SA (`BORME-A-2021-202-28`).
- CAMPO ABADIA SL (B42819029) se constituye el 1 feb 2021, cobra del instituto de competitividad de Castilla y León y se extingue el 12 ene 2023 (`BORME-A-2023-8-37`).
- Doce sociedades distintas cobran de la Consejería de Economía de Madrid y el BORME nombra administrador a GRUPO LARRUMBA HOLDING SL.

Límites que el indicador no resuelve: una extinción puede ser una fusión (el anuncio dice «Disolución. Fusión. Extinción» y aquí cuenta como cierre); el capital de 1 € puede ser una limitada en formación sucesiva, que es legal; el administrador se publica sin DNI, así que un homónimo basta para enlazar dos sociedades; el domicilio de una gestoría concentra empresas que no forman un grupo.

```bash
python3 pipeline/contratos.py
```

El cruce con contratación pública es opcional: `pnpm data` no lo descarga y el índice de subvenciones se abre igual si falta. Hace falta el SQLite ya construido. El script lee la sindicación ATOM/CODICE de la [Plataforma de Contratación del Sector Público](https://contrataciondelsectorpublico.gob.es) (datos abiertos del Ministerio de Hacienda), años 2018 a 2022, y borra cada ZIP al terminar. Con `--keep-raw` los deja en `data/raw/placsp/`, que no se versiona.

Tres canales, porque ninguno trae el conjunto entero:

| Canal | Qué publica | URL del ZIP anual |
| --- | --- | --- |
| `perfiles` | Licitaciones de órganos con perfil en la propia PLACSP, sin menores | `sindicacion_643/licitacionesPerfilesContratanteCompleto3_AAAA.zip` |
| `menores` | Contratos menores de esos mismos perfiles, desde 2018 | `sindicacion_1143/contratosMenoresPerfilesContratantes_AAAA.zip` |
| `agregadas` | Licitaciones que llegan desde plataformas autonómicas, sin menores | `sindicacion_1044/PlataformasAgregadasSinMenores_AAAA.zip` |

El fichero de un año no es «lo adjudicado ese año»: es el paquete de actualizaciones de ese año. Puede repetir un expediente y puede no traer un contrato de 2018 que solo se modificó en 2023. Se conserva la actualización más reciente y se filtra por la fecha, de 2018 a 2022. En los perfiles y en los menores esa fecha es la de adjudicación. En las plataformas agregadas el anuncio casi nunca la trae: se usa la publicación más reciente del anuncio y el texto del indicador lo dice. Solo se guardan adjudicaciones (códigos de resultado 1, 2, 8, 9 y 11) cuyo NIF ya está entre los beneficiarios. El NIF se lee aunque venga con guiones. El resto del XML no se almacena. Un mismo número de expediente en dos canales no se pisa: la clave lleva el canal.

Emparejar el organismo de la ayuda con el órgano de contratación es una aproximación. La BDNS no trae DIR3. El código se lee del anuncio (`schemeName="DIR3"` en el órgano y, si viene, en sus unidades superiores) y se asocia a un nombre ya normalizado. La normalización quita tildes y puntuación, unifica `Ajuntament`/`Concello`/`Udala` con ayuntamiento, `Xunta` con junta, y tira partículas (`de`, `la`, `y`). Un nombre que en la PLACSP apunta a un solo DIR3 puede reconocer ese código en otro anuncio, pero solo si los dos rótulos comparten una palabra propia (Patrimonio, Logroño). Algunos códigos se reutilizan en unidades que no son la misma —el del Instituto de Astrofísica de Canarias aparece también como ministerio— y en ese caso no se salta de un nombre al otro. Si el mismo nombre apunta a varios códigos, tampoco se usa.

El indicador salta, dentro de 180 días, en este orden:

1. **Mismo órgano.** El nombre normalizado coincide, o los dos lados comparten un DIR3 único, o los dos son el mismo ayuntamiento, diputación o cabildo aunque uno diga «junta de gobierno».
2. **Misma jerarquía.** El organismo de la ayuda es una unidad superior en el anuncio, o los dos títulos son el mismo ministerio o la misma consejería tras unificar renombres de 2018-2022 (Hacienda y Función Pública con Hacienda, por ejemplo).
3. **Misma administración.** Solo si el contrato es menor, negociado sin publicidad (código 3 del listado 2.07; el 4 es con publicidad), tramitación de emergencia o encargo formalizado. Aquí entran dos consejerías distintas de la misma comunidad, no todo el Estado con todo el Estado: «Administración General del Estado» se trata como un cajón, no como un órgano.

Un padre de una sola palabra («Toledo», «Murcia») no se toma como órgano: en la jerarquía es la provincia, y casaría con todos los municipios. Valencia y Valencia de Don Juan tampoco se mezclan, porque el topónimo se compara entero.

La pantalla lo etiqueta como indicador. Cada ficha dice qué regla ha saltado, enlaza las concesiones y el anuncio de la PLACSP, y se puede filtrar por territorio, año de adjudicación y organismo. No están los contratos menores de las plataformas autonómicas: el canal agregado los excluye y el de menores solo cubre perfiles alojados en la PLACSP.

Sobre este índice (concesiones a personas jurídicas, 2018–marzo de 2022) la pasada leyó 3.986.699 anuncios y guardó 1.202.741 adjudicaciones de 94.653 NIF, el 10,6 % de los 894.548 beneficiarios con NIF. De 2.324 organismos que conceden a alguien con NIF, 677 (29,1 %) tienen el mismo nombre normalizado que un órgano de la PLACSP y 211 (9,1 %) apuntan a un único DIR3; 14 nombres son ambiguos. Salen 31.995 indicadores: 7.386 del mismo órgano, 1.060 de la jerarquía y 23.549 de la misma administración (estos solo si el contrato es menor o no salió a convocatoria abierta). 27.711 son contratos menores.

Tres casos reales: Ferias Jaén S.A. (A23398001) cobra de la Diputación Provincial de Jaén y el 27/12/2019 la presidencia de esa diputación le adjudica un contrato menor de 111.520 €, 35 días después de una concesión. La Fundación APIP-ACAM (G65529661) recibe ayuda del Ayuntamiento de Barcelona y el mismo 25/01/2018 el Ajuntament de Barcelona le adjudica por negociado sin publicidad un contrato de 1,4 millones, publicado en el canal agregado. Gestión Insular de Deporte, Cultura y Ocio (A38615191) cobra del Cabildo Insular de Tenerife y ese cabildo, a través de su dirección insular de recursos humanos, le adjudica un contrato menor el mismo día.

```bash
python3 pipeline/politicos.py
python3 pipeline/vinculos.py
```

Vínculos políticos cruza dos cosas: un cargo público y el administrador de la sociedad que cobra. El cargo sale de listas abiertas. El administrador tiene que estar en la tabla `borme_admins(nif, nombre, cargo, desde, hasta)`, que construye otro proceso (el BORME) y que este comando no rellena. Sin esa tabla el comando termina sin escribir indicadores. `pipeline/fixtures/borme_admins.csv` es un ejemplo mínimo para probar el cruce antes de que existan los administradores reales:

```bash
python3 pipeline/vinculos.py --fixture
python3 pipeline/vinculos.py --self-check
```

Solo se publica una coincidencia si la confianza llega a 0,85. Hace falta el nombre y los dos apellidos (o un solo apellido largo y poco común), que el nombre no esté en tres o más órganos, que la subvención caiga dentro del mandato y del cargo societario, y que el órgano que concede sea el del cargo: el municipio del concejal o del alcalde, el cabildo del consejero insular, el parlamento del diputado autonómico, o el departamento del alto cargo. Un apoderado baja la nota. Si el nombramiento societario no trae fechas, también. Por debajo del umbral no se guarda la fila.

En la ingesta de noviembre de 2026 la tabla `politico` quedó en unas 152.000 filas, unos 63 MB:

| Fuente | Qué entra | Cobertura en ese cruce |
| --- | --- | --- |
| Ministerio del Interior, ficheros de candidatos electos (municipales 24 may 2015 y 26 may 2019) | Concejales. El fichero 04 son los municipios de lista cerrada; el 12, los de lista abierta (menos de 250 habitantes). | 67.185 electos en 2015 (8.091 municipios) y 66.679 en 2019 (8.120). No se guardan DNI ni fecha de nacimiento. |
| El mismo ministerio, cabildos insulares de esas dos fechas | Miembros electos del cabildo. | 150 en 2015 y 156 en 2019, siete islas. |
| Ministerio de Política Territorial, registro de alcaldes (xlsx de los mandatos 2015-2019 y 2019-2023) | Titular de la alcaldía, con posesión y baja. | 8.822 y 8.682 filas. Casi todas casan con un concejal electo del mismo municipio (8.657 y 8.494). |

Las fechas de un concejal son las del mandato (13 jun 2015 – 14 jun 2019, y 15 jun 2019 – 16 jun 2023), no el día en que esa persona tomó posesión o cesó. Quien entra a mitad de mandato por una renuncia no está, y quien dimite sigue figurando hasta el final del mandato. En los alcaldes sí constan posesión y baja.

El Interior no publica el fichero de candidatos de las elecciones autonómicas: se lo pidieron y respondió que es competencia de cada comunidad. Los CSV autonómicos que hay en datos.gob.es para este periodo son recuentos de escaños o de votos, no listas nominales reutilizables. El módulo acepta un diputado autonómico si otra carga lo inserta en `politico` con `rol = diputado`, y solo lo cruza con ayudas del propio parlamento, no con todas las de la comunidad. Los altos cargos se cruzan solo si el nombre del departamento aparece en el órgano que concede. Esta ingesta no trae una nómina estatal de altos cargos: el BOE publica los nombramientos como texto diario, no como padrón.

El Tribunal de Cuentas fiscaliza la contabilidad de los partidos en PDF. No hay un fichero reutilizable de donantes identificables para 2018-2022, y una donación no dice que el administrador sea cargo del órgano que concede. No se usa.

El indicador es solo eso. Un homónimo con los mismos apellidos puede no ser el cargo. No dice que votara la ayuda, que estuviera en la junta de gobierno ni que el expediente incumpla la Ley General de Subvenciones. La ficha enlaza la fuente oficial. El área de descargas del Interior a veces exige un reto anti-bots; si el zip falla, el script baja los mismos `.DAT` desde la copia íntegra de [JaimeObregon/infoelectoral](https://github.com/JaimeObregon/infoelectoral). La cita de cada persona sigue siendo la página del ministerio.

## Arranque

Hace falta Node.js 22 y Python 3.10 o superior. El pipeline solo usa la biblioteca estándar.

```bash
pnpm install
pnpm data
pnpm dev
```

La aplicación queda en [http://127.0.0.1:43123](http://127.0.0.1:43123).

`pnpm data` descarga los CSV en `data/raw/` (no se versionan) y escribe `data/bdns.sqlite`. Si los gzip ya están y pesan más de 1 MB, no los vuelve a bajar. Para forzar la descarga, borra `data/raw/`.

El cruce con contratos públicos, si se quiere, va después y no toca el resto del índice:

```bash
pnpm contratos
```

Equivale a `python3 pipeline/contratos.py`. `--years 2018-2022`, `--feeds perfiles,menores,agregadas`, `--keep-raw`, `--alerts-only` y `--rebuild` están en el propio script. La autocomprobación, sin red y sin base de datos:

```bash
python3 pipeline/contratos.py --self-check
```

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
- Anuncios del Registro Mercantil: Agencia Estatal Boletín Oficial del Estado, [API de sumarios del BORME](https://www.boe.es/datosabiertos/api/api.php), reutilizados con las condiciones de la sede electrónica.
