# Roadmap API Facturación Electrónica DGII

> **RECUPERACIÓN**: Este documento fue borrado del disco junto con el proyecto `contabilidad-rd` y el vault Obsidian `C:\Dev\Obsidian Vault`. Fue **reconstruido byte-a-byte** el 2026-07-24 minando el historial de sesión `C:/Dev/DGII-RECOVERY/session-backups/vault-dgii-analysis_ccfa0077.jsonl`, aplicando en orden la llamada `Write` original (línea de evento 311) y las 3 llamadas `Edit` posteriores (líneas 322, 330, 338) que Claude ejecutó para escribir el archivo en el vault. El resultado coincide exactamente con el conteo reportado por la sesión original: **1065 líneas / 109156 bytes** (`wc -l` en línea de evento 348). No se alteró ni se completó ningún contenido — es el texto original, letra por letra.
>
> **Documento maestro de implementación** — Generado el 2026-07-02 a partir del análisis exhaustivo del vault (11 notas, 15 PDFs oficiales DGII, 14 esquemas XSD).
> Convención de citas: `[archivo, página/sección, versión, confianza]`. Confianza: **alta** = texto literal del documento; **media** = inferencia razonable; **baja** = dato dudoso o con artefacto de extracción.
> Regla de oro: **los documentos oficiales DGII mandan sobre las notas del vault**. Donde contradicen, se usa el oficial y se registra en §22.

---

## 1. Resumen ejecutivo

### Qué se construye
Una **API de facturación electrónica independiente** que actúa como capa intermedia entre el ERP/POS (en desarrollo) y la DGII (República Dominicana). El ERP/POS envía documentos de venta en JSON simple; la API se encarga de TODA la complejidad fiscal: validación, numeración e-NCF, generación XML, firma digital XMLDSig, envío a DGII, seguimiento de estados, reintentos, acuses, anulaciones, contingencia y trazabilidad.

```text
ERP/POS  ──JSON──▶  API Facturación Electrónica  ──XML firmado──▶  DGII
ERP/POS  ◀─webhook/estado──  API  ◀──TrackId/estados──  DGII
```

### Objetivo del proyecto
Quedar **certificado como Emisor Electrónico** ante la DGII (proceso de 3 etapas: Solicitud → Set de Pruebas → Certificación `[Proceso de Certificacion..., pág. 2, Julio 2025, alta]`) y operar en producción emitiendo e-CF válidos, con el ERP/POS conectándose a la API sin conocer ningún detalle de la DGII.

### Alcance inicial (MVP certificable)
- Emisión de e-CF tipos **31** (Crédito Fiscal), **32** (Consumo, incl. flujo RFCE < RD$250,000), **33** (Nota de Débito), **34** (Nota de Crédito).
- Autenticación semilla→token contra DGII; firma digital XMLDSig con certificado .p12.
- Envío, consulta de resultado (TrackId), manejo de estados 0–4.
- Anulación de rangos de secuencias (ANECF).
- **Servicios expuestos como emisor-receptor** (obligatorios para certificación): Autenticación (opcional), Recepción `/fe/recepcion/api/ecf` (devuelve ARECF firmado) y Aprobación Comercial `/fe/aprobacioncomercial/api/ecf` `[Descripcion-tecnica, págs. 52-57, v1.6, alta]`.
- Representación Impresa (PDF con QR versión 8) — requerida en el paso 5 del set de pruebas `[Proceso de Certificacion..., pág. 12, alta]`.
- Idempotencia, reintentos, webhooks al ERP/POS, auditoría completa.

### Alcance futuro
- Tipos 41, 43, 44, 45, 46, 47 (los XSD ya están analizados; el motor XML se diseña para los 10 tipos desde el día 1).
- Emisión de Aprobación Comercial **saliente** (cuando actuemos como receptor de compras).
- Módulo de contingencia automatizado, con los **tres regímenes de §5.1** modelados por separado y alcance PARTIAL/TOTAL por sucursal (la declaración en OFV es manual, pero la cola de envío diferido a 72h sí se automatiza).
- Multiempresa completo (el modelo de datos lo contempla desde el inicio; la UI de administración es futura).

### Fuera de alcance
- El ERP/POS en sí (es cliente de esta API).
- Contabilidad, inventario, reportería fiscal (606/607).
- Obtención del certificado digital (trámite humano ante Viafirma/Digifirma/Novofirma `[Solicitud Usuario Administrador, pág. 4, Oct 2025, alta]`).
- Trámites en Oficina Virtual (Usuario Administrador, delegaciones, declaración de contingencia): la API los documenta y asiste, pero son acciones humanas en la OFV.

### Supuestos detectados
| # | Supuesto | Base |
|---|----------|------|
| S1 | Se certifica por la **ruta directa** (software propio), no vía Proveedor de Servicios certificado | El vault documenta ambas rutas; la directa exige el set completo de 14 pasos `[Proceso de Certificacion..., págs. 4-21, alta]` |
| S2 | Stack recomendado: **TypeScript** (`xmlbuilder2`, `xml-crypto`) | Nota del vault `[_AI_Context_Guide.md, alta]` — ver alternativas en §4.3 D1 |
| S3 | Emisor único al inicio, pero modelo de datos multiempresa | Requisito del dueño ("multiempresa si aplica") |
| S4 | El receptor mayoritario inicial será consumidor final (tipo 32) y clientes con RNC (tipo 31) | Naturaleza POS |

### Riesgos principales (detalle completo en §22)
1. **Brechas de plazos oficiales**: no hay plazo documentado para acuse de recibo ni aprobación comercial; sin timeouts/rate limits de los servicios DGII.
2. **Derivación exacta del código de seguridad (`OPEN-DGII-01`)**: el **requisito está confirmado** — son los primeros seis elementos derivados del hash / `SignatureValue` de la firma digital, y así se enuncia tanto para el e-CF ordinario como para el RFCE. Lo que sigue abierto es la **operación exacta**. No bloquea la RI ni el QR completos, solo la generación final del valor (§22 R6).
3. **Convivencia RFCE vs e-CF 32 completo <250k** no aclarada por los documentos (§22 R4).
4. **Documentos con versiones cruzadas**: Descripción Técnica dice v1.6 en portada y v1.5 en pie; RFCE de 2020 vs Formato e-CF de 2025.
5. **Anomalías en los XSD oficiales** que pueden romper validadores (espacio en un `name`, regex con `.` sin escapar) (§22 R8).
6. **Vencimiento de secuencias del ambiente de pruebas: 31-12-2025** según doc de 2023 — **ya vencido a la fecha de este roadmap (2026-07-02)**; debe verificarse el estado actual del ambiente TesteCF (§22 R12).

---

## 2. Inventario de documentación del vault

### 2.1 Notas markdown (11)

| Documento | Ruta | Tema | Versión/fecha | Relevancia | Observaciones |
|-----------|------|------|---------------|------------|---------------|
| 00_DGII_MOC.md | `01_Projects/DGII_Facturacion/` | Índice del proyecto | — | Media | Mapa de contenido; roadmap embrionario |
| _AI_Context_Guide.md | `01_Projects/DGII_Facturacion/` | Guía para agentes | — | Media | Stack recomendado TS; reglas críticas |
| _Especificaciones_Tecnicas.md | `01_Projects/DGII_Facturacion/` | Protocolos/seguridad | Basada en "manual v1.6" | Media | Resumen derivado; correcto en lo esencial |
| _Flujos_Interaccion.md | `01_Projects/DGII_Facturacion/` | Ciclo de vida | — | Media | ⚠️ Afirma "resumen diario" RFCE — contradice formato oficial (§22 R5) |
| _Modelos_Datos.md | `01_Projects/DGII_Facturacion/` | Modelos/catálogos XSD | — | Alta | Buen resumen de catálogos; verificado contra XSD |
| _Validaciones_Negocio.md | `01_Projects/DGII_Facturacion/` | Reglas de negocio | — | Alta | e-NCF, decimales, fechas, ITBIS |
| _API_Endpoints_Flujos.md | `20_Areas/Desarrollo_DGII/` | Endpoints DGII | — | Media | ⚠️ Estado 3 mal documentado (dice Aceptado Condicional; oficial: 3=En Proceso, 4=Aceptado Condicional) (§22 R9) |
| _Certificacion_Emisor.md | `20_Areas/Desarrollo_DGII/` | Certificación | 2026-03-21 | Alta | Consistente con PDF oficial de Julio 2025 |
| _Criptografia_Firma_Digital.md | `20_Areas/Desarrollo_DGII/` | Firma XMLDSig | — | Alta | ⚠️ Código de seguridad: redacción ambigua (§22 R6) |
| _Reglas_XML_Validaciones.md | `20_Areas/Desarrollo_DGII/` | Restricciones XML | — | Alta | Tags vacíos, redondeo, tolerancia, nomenclatura |
| _Representacion_Impresa_QR.md | `20_Areas/Desarrollo_DGII/` | RI y QR | — | Alta | QR v8, 22×22mm, URL consultatimbre |

### 2.2 PDFs oficiales DGII (15)

| Documento | Tema | Versión/fecha | Relevancia | Observaciones |
|-----------|------|---------------|------------|---------------|
| Descripcion-tecnica-de-facturacion-electronica.pdf | **Servicios web, auth, ambientes** | ⚠️ v1.6 Jun 2023 (portada) / v1.5 May 2023 (pie) | **CRÍTICO** | Fuente principal de §10; contradicción de versión (§22 R1) |
| Informe Técnico e-CF v1.0.pdf | Modelo general, tipos, e-NCF, flujos, tolerancias | v1.0, Ago 2022 | **CRÍTICO** | 50 págs; tolerancias de cuadratura, plazos, QR |
| Formato Comprobante Fiscal Electrónico (e-CF) V1.0.pdf | Diccionario campo a campo del XML | v1.0, **Oct 2025** (bitácora activa) | **CRÍTICO** | El más actualizado del vault |
| Formato Resumen Factura Consumo Electrónica v1.0.pdf | RFCE <250k | v1.0, Ene 2020 | **CRÍTICO** | ⚠️ 5 años más viejo que el Formato e-CF (§22 R4) |
| Formato Acuse de Recibo v 1.0.pdf | ARECF | v1.0, sin fecha | **CRÍTICO** | Sin ejemplo XML |
| Formato Aprobación Comercial v1.0.pdf | ACECF | v1.0, Ene 2020 | **CRÍTICO** | Sin ejemplo XML |
| Formato Anulación de e-NCF v1.0.pdf | ANECF | v1.0, act. 24-05-2022 | **CRÍTICO** | ⚠️ Contradicción interna 8 vs 10 repeticiones (§22 R7) |
| Firmado de e-CF.pdf | Firma XMLDSig + código en 5 lenguajes | Mar 2023, sin nº versión | **CRÍTICO** | Estructura Signature exacta; parches a librería PHP |
| Instructivo App Firma Digital.pdf | App de escritorio para firmar | v1.0, Ene 2020 | Auxiliar | Necesaria para firmar la Declaración Jurada |
| Proceso de Certificacion para ser Emisor Electronico.pdf | Certificación ruta directa | Jul 2025 | **CRÍTICO** | 3 etapas, 14 pasos del set de pruebas |
| Proceso-Certificacion-...-Proveedor-Servicios-FECertificado.pdf | Certificación vía proveedor | Mar 2025 | Auxiliar | Solo si se abandona la ruta directa (supuesto S1) |
| Solicitud Usuario Administrador de e-CF.pdf | Usuario Admin e-CF | Oct 2025 | Alta | Prerrequisito ANTES de solicitar ser emisor |
| Instructivo Delegaciones de Roles de Facturación Electrónica.pdf | Roles: Solicitante, Firmante, Aprobador, Admin | v2.0, Jun 2025 | Alta | Flujo de delegación vía OFV |
| Instructivo-Contingencia-FE.pdf | Contingencia | Feb 2026 | **CRÍTICO** | Tres regímenes distintos con plazos distintos: 72h (sin conectividad), 15 días **calendario** (imposibilidad de emitir) + 30 días calendario de regularización, y 15 días **hábiles** (contingencia de la DGII). Ver §5.1 |
| Representación Impresa (Modelos ilustrativos).pdf | 12 modelos de RI | Sin fecha/versión | Alta | ⚠️ Error de plantilla en modelo papel continuo (§22 R10) |

### 2.3 Esquemas XSD (14 + 1 semilla)

| Esquema | Raíz | Uso | Relevancia |
|---------|------|-----|------------|
| e-CF 31/32/33/34/41/43/44/45/46/47 v.1.0.xsd | `ECF` | Validación de cada tipo de comprobante | **CRÍTICO** |
| ARECF v1.0.xsd | `ARECF` | Acuse de recibo | **CRÍTICO** |
| ACECF v.1.0.xsd | `ACECF` | Aprobación comercial | **CRÍTICO** |
| ANECF v.1.0.xsd | `ANECF` | Anulación de rangos | **CRÍTICO** |
| RFCE 32 v.1.0.xsd | `RFCE` | Resumen factura consumo <250k | **CRÍTICO** |
| Semilla v.1.0.xsd | `SemillaModel` | Autenticación | **CRÍTICO** |

Ningún esquema declara `targetNamespace` (todos "sin namespace") `[XSDs, alta]`.

### 2.4 Clasificación
- **Documentos críticos** (leer completos antes de implementar cada módulo): los 8 marcados CRÍTICO en PDFs + los 15 XSD.
- **Conflictivos o repetidos**: Descripción Técnica (versión interna contradictoria); RFCE 2020 vs Formato e-CF 2025; notas del vault `_API_Endpoints_Flujos` y `_Flujos_Interaccion` con errores respecto a los oficiales.
- **Requieren revisión humana**: tabla de caracteres reservados del QR (pág. 58 de Descripción Técnica — extracción de texto desalineada, cotejar visualmente); celda ilegible en Anexo I del PDF de Anulación (pág. 9); largo del campo `Version` en ARECF/ACECF.

---

## 3. Glosario técnico y fiscal

| Término | Definición (basada en el vault) | Fuente |
|---------|--------------------------------|--------|
| **DGII** | Dirección General de Impuestos Internos; administra y aplica tributos (Ley 11-92, Arts. 32/34/35) | `[Informe Técnico, pág. 7, alta]` |
| **e-CF** | Comprobante Fiscal Electrónico: XML firmado digitalmente con validez fiscal | `[Informe Técnico, pág. 7, alta]` |
| **RNC** | Registro Nacional del Contribuyente; 9 dígitos (empresas) u 11 (cédula) — regex `[0-9]{11}\|[0-9]{9}` | `[XSD e-CF 31, RNCValidationType, alta]` |
| **e-NCF** | Número de Comprobante Fiscal electrónico: 13 posiciones = `E` + tipo (2) + secuencia (10). Ej: `E310000000001`. Vigencia: hasta el 31/12 del año siguiente a la autorización | `[Informe Técnico, pág. 14, alta]` |
| **Tipos de e-CF** | 31 Crédito Fiscal, 32 Consumo, 33 Nota Débito, 34 Nota Crédito, 41 Compras, 43 Gastos Menores, 44 Regímenes Especiales, 45 Gubernamental, 46 Exportaciones, 47 Pagos al Exterior (no existe 42 documentado) | `[Informe Técnico, págs. 13-14, alta]` |
| **Emisor electrónico** | Contribuyente autorizado por DGII a emitir e-CF | `[Informe Técnico, pág. 7, alta]` |
| **Receptor electrónico** | Contribuyente que recibe e-CF; "todo receptor electrónico es a su vez emisor electrónico" | `[Informe Técnico, pág. 7, alta]` |
| **Firma digital** | XMLDSig *enveloped*, RSA-SHA256, C14N inclusiva, `Reference URI=""` (firma todo el documento) | `[Firmado de e-CF, págs. 3-4, alta]` |
| **Certificado digital** | Para Procedimiento Tributario, formato .p12, emitido por entidad autorizada por INDOTEL (Viafirma, Digifirma, Novofirma) | `[Firmado de e-CF, pág. 4; Solicitud Usuario Admin, pág. 4, alta]` |
| **Semilla** | XML `SemillaModel {valor, fecha}` que DGII entrega; se firma y devuelve para obtener token | `[Descripcion-tecnica, pág. 9-10, v1.6, alta]` |
| **Token** | Bearer token (RFC 6750), duración 1 hora "por el momento" | `[Descripcion-tecnica, pág. 10, alta]` |
| **TrackId** | Identificador `string` que DGII retorna al recibir un e-CF; permite consultar el resultado. Un mismo e-NCF puede tener múltiples TrackIds si se reenvió | `[Descripcion-tecnica, págs. 11-12, 24, alta]` |
| **Estados DGII (por TrackId)** | 0 No encontrado, 1 Aceptado, 2 Rechazado, 3 En Proceso, 4 Aceptado Condicional | `[Descripcion-tecnica, págs. 19-20, alta]` |
| **Aceptado Condicional** | Recibido con irregularidad no crítica; **implica validez fiscal** del e-CF | `[Informe Técnico, pág. 12; Descripcion-tecnica, pág. 20, alta]` |
| **ARECF** | Acuse de Recibo: respuesta receptor→emisor; Estado 0=Recibido, 1=No Recibido (motivos 1-4). No implica aceptación comercial | `[Formato Acuse, págs. 3-5, v1.0, alta]` |
| **ACECF** | Aprobación Comercial (opcional): Estado 1=Aceptado, 2=Rechazado; copia a DGII; solo sobre e-CF ya aceptados por DGII | `[Formato Aprobación, págs. 2-5, v1.0, alta]` |
| **ANECF** | Anulación de rangos de secuencias e-NCF **no utilizadas** (si ya se envió a DGII/receptor, corresponde Nota de Crédito 34) | `[Formato Anulación, pág. 3, v1.0, alta]` |
| **RFCE** | Resumen de Factura de Consumo <RD$250,000: se envía el resumen a DGII (vía `fc.dgii.gov.do`), no la factura completa; respuesta síncrona sin TrackId | `[Formato RFCE, pág. 2, v1.0; Descripcion-tecnica, págs. 13-16, alta]` |
| **Código de seguridad** (`OPEN-DGII-01`) | Primeros 6 elementos derivados del hash / `SignatureValue` de la firma digital. Se indica en palabras debajo del QR, viaja como parámetro del QR de la RI y viaja como campo transmitido en el RFCE (`CodigoSeguridadeCF`, ALFANUM, longitud máx. 6). Asimetría estructural: el XML del e-CF ordinario **no** tiene elemento de código de seguridad — allí es solo artefacto de impresión y QR. ⚠️ La derivación exacta sigue abierta (§22 R6) | `[Informe Técnico e-CF v1.0, Marzo 2026, pág. 36; Descripción Técnica Servicios DGII, rev. 02-01-2026, págs. 21 y 28; Formato RFCE v1.0, Enero 2020, pág. 12, alta]` |
| **Representación Impresa (RI)** | Versión física/PDF del e-CF; legibilidad mínima 10 años; QR versión 8, ≥22×22mm, esquina inferior izquierda | `[Informe Técnico, págs. 30-38; _Representacion_Impresa_QR.md, alta]` |
| **Contingencia** | Situación excepcional o imprevista que impide emitir, transmitir o validar e-CF. **No es un modo único**: son tres regímenes con plazos propios (§5.1) — `OFFLINE_TRANSMISSION_CONTINGENCY`, `NON_ELECTRONIC_ISSUANCE_CONTINGENCY` y `DGII_PLATFORM_CONTINGENCY` | `[Instructivo-Contingencia, Feb 2026, págs. 3, 5, 9, 12, alta]` |
| **Contingencia parcial / total** | Parcial: la falla afecta solo una parte de las operaciones, es decir una o varias sucursales o unidades de negocio no pueden facturar electrónicamente pero el resto sigue operando. Total: afecta la operación total del contribuyente o todas sus sucursales. La declaración de entrada en OFV exige elegir "Total" o "Parcial" | `[Instructivo-Contingencia, Feb 2026, pág. 3 Glosario; pág. 6 Paso 1, alta]` |
| **Serie B** | Comprobante Fiscal No Electrónico: documento autorizado emitido en formato físico o manual, sin usar los sistemas de facturación electrónica. Se usa únicamente en el régimen de imposibilidad de emitir (máx. 15 días calendario) y se reemplaza después por e-CF enviados **solo a la DGII** | `[Instructivo-Contingencia, Feb 2026, pág. 3 Glosario; pág. 5 punto 2; pág. 12, alta]` |
| **TesteCF / CerteCF / eCF** | Ambientes: Pre-Certificación (pruebas), Certificación (set de pruebas formal), Producción | `[Descripcion-tecnica, pág. 5, alta]` |
| **OFV** | Oficina Virtual DGII: trámites (solicitud emisor, contingencia, delegaciones, buzón) | `[Proceso de Certificacion, alta]` |
| **Delegación de roles** | Asignación de roles Solicitante/Firmante/Aprobador Comercial/Administrador a personas físicas vía OFV | `[Instructivo Delegaciones, v2.0, pág. 1, alta]` |
| **IndicadorFacturacion** | Por línea: 0 No facturable, 1 ITBIS 18%, 2 ITBIS 16%, 3 ITBIS 0%, 4 Exento | `[Formato e-CF; XSD, alta]` |
| **XSD** | Esquema de validación estructural; validar ANTES de firmar y enviar | `[_Especificaciones_Tecnicas.md, alta]` |

---

## 4. Arquitectura propuesta

### 4.1 Componentes principales

| # | Módulo | Responsabilidad | Fuentes clave |
|---|--------|-----------------|---------------|
| 1 | **API Pública** (`api-gateway`) | REST `/api/v1` para ERP/POS; autenticación de clientes; idempotencia; versionado | §6 |
| 2 | **Motor de Validación Fiscal** (`fiscal-validator`) | Reglas de negocio pre-XML: e-NCF, RNC, totales, ITBIS, tolerancias ±1/línea, redondeo, fechas | `[Informe Técnico, págs. 20-21]`, `[_Validaciones_Negocio.md]` |
| 3 | **Motor XML** (`xml-engine`) | JSON→XML por tipo (10 plantillas), escapado, sin tags vacíos, validación XSD | §8 |
| 4 | **Motor de Firma** (`signer`) | XMLDSig enveloped RSA-SHA256/C14N; firma de e-CF, semilla, ARECF, ACECF, ANECF, RFCE; extracción código de seguridad | §9 |
| 5 | **Cliente DGII** (`dgii-client`) | Auth semilla/token (caché ~50 min), envío, consultas, anulación, directorio, estatus servicios | §10 |
| 6 | **Servicios Emisor-Receptor** (`inbound-services`) | Endpoints públicos exigidos: `/fe/recepcion/api/ecf` (→ARECF firmado) y `/fe/aprobacioncomercial/api/ecf` (→200/400); auth semilla propia opcional | `[Descripcion-tecnica, págs. 52-57]` |
| 7 | **Gestor de Secuencias** (`sequence-manager`) | Asignación atómica de e-NCF por empresa+tipo; control de vencimiento (31/12 año siguiente); alertas de agotamiento; anulación de rangos | `[Informe Técnico, pág. 14]` |
| 8 | **Máquina de Estados** (`state-machine`) | Estados internos + mapeo a estados DGII 0-4; eventos | §11 |
| 9 | **Cola de Trabajos** (`job-queue`) | Envíos asíncronos, polling de TrackId, reintentos con backoff, envío diferido/contingencia 72h | §10, §13 |
| 10 | **Base de Datos** | PostgreSQL (recomendado); XML como archivos o TEXT; ver §15 | §15 |
| 11 | **Auditoría/Logs** (`audit`) | Evento por transición; request/response DGII completos; sin datos sensibles en logs | §14 |
| 12 | **Generador RI** (`ri-generator`) | PDF con QR v8, código de seguridad, fecha firma; modelos según tipo | `[Informe Técnico, págs. 30-38]` |
| 13 | **Configuración Multiempresa** (`tenant-config`) | Empresa emisora, certificado, secuencias, ambiente activo, URLs propias del directorio | §7 |

### 4.2 Diagrama lógico

```text
                                ┌──────────────────────────────────────────────┐
 ERP/POS ──POST /invoices──▶    │  API Facturación Electrónica                 │
   ▲                            │                                              │
   │  webhooks / GET status     │  [1 API Pública]──▶[2 Validación Fiscal]     │
   └────────────────────────    │        │                   │                 │
                                │        ▼                   ▼                 │
                                │  [7 Secuencias]──▶[3 Motor XML]──▶[XSD ok?]  │
                                │                          │                   │
                                │                    [4 Firma XMLDSig]         │
                                │                          │                   │
                                │              [12 RI/PDF+QR]  [9 Cola]        │
                                │                          │      │            │
                                │                    [5 Cliente DGII]          │
                                └───────────┬──────────────┬───────────────────┘
                                            │              │
             semilla/token, POST ecf/RFCE,  ▼              ▼  polling estado
        ┌────────────────────────────────────────────────────────────┐
        │ DGII: ecf.dgii.gov.do / fc.dgii.gov.do / statusecf...      │
        └────────────────────────────────────────────────────────────┘
                                            ▲
        Receptores/DGII ──POST e-CF──▶ [6 Servicios Emisor-Receptor] ──ARECF──▶
```

Nota: el flujo difiere del genérico del prompt en un punto documentado: para **factura de consumo <RD$250,000** el envío es del **resumen (RFCE)** a `fc.dgii.gov.do` con **respuesta síncrona sin TrackId** `[Descripcion-tecnica, págs. 13-16, alta]`.

### 4.3 Decisiones arquitectónicas

| ID | Decisión | Razón | Alternativas | Riesgos | Fuente |
|----|----------|-------|--------------|---------|--------|
| D1 | **TypeScript/Node.js** como lenguaje base | Recomendado por el vault; DGII publica ejemplo oficial de firma en TS; un solo lenguaje con el futuro POS | C#/.NET (SignedXml nativo, el más maduro para XMLDSig); Java (javax.xml.crypto) | `xml-crypto` requiere configuración cuidadosa de C14N inclusiva; el ejemplo oficial TS implementa C14N a mano | `[_AI_Context_Guide.md]`, `[Firmado de e-CF, págs. 6-14]` |
| D2 | **Monolito modular** (módulos §4.1 como paquetes, no microservicios) | Un solo equipo; despliegue simple; los límites de módulo ya están definidos | Microservicios | Acoplamiento si no se respetan límites | Decisión propia |
| D3 | **PostgreSQL** | Transacciones fuertes para secuencias (atomicidad crítica), JSONB para payloads, índices únicos para idempotencia | MySQL, SQL Server | — | Decisión propia |
| D4 | **Cola persistente en DB** (tabla `jobs` + worker) en MVP; migrable a Redis/BullMQ | Menos infraestructura; los volúmenes iniciales de POS no exigen broker dedicado | RabbitMQ, BullMQ | Throughput limitado a escala alta | Decisión propia |
| D5 | XML almacenado **íntegro** (sin firmar y firmado) por 10 años | Obligación de conservación de 10 años | Solo firmado | Espacio en disco | `[Informe Técnico, pág. 18: Art. 50 lit. h, alta]` |
| D6 | Los 10 XSD se versionan **dentro del repo** y la validación XSD es obligatoria pre-firma | "Validarlo contra el XSD en tu código para capturar errores sin desperdiciar tokens de autenticación" | Validación solo en DGII | Divergencia si DGII actualiza XSD (bitácora del Formato e-CF cambia sin cambiar versión) | `[_Especificaciones_Tecnicas.md]`, §22 R11 |
| D7 | **Decimal de precisión fija** (nunca float/double) | "Prohibido usar tipos float o double (IEEE 754 causa rechazos por centavos)"; usar decimal.js/BigDecimal | — | — | `[_Reglas_XML_Validaciones.md, alta]` |
| D8 | Multiempresa en el modelo de datos desde el día 1 (`company_id` en todas las tablas fiscales) | Migrar después es costoso; certificado y secuencias son por RNC | Single-tenant | Complejidad marginal | Requisito del dueño |
| D9 | Refresco de token a los **50 minutos** (caché por empresa+ambiente) | Token dura 1h "por el momento"; margen de 10 min evita cortes en envíos masivos | Refresco reactivo en 401 | Cambio unilateral de duración por DGII (documentado como provisional) | `[_Validaciones_Negocio.md]`, `[Descripcion-tecnica, pág. 10]` |
| D10 | Polling de TrackId con backoff corto: 2s → 5s → 15s → 60s → 5min (validación promedio DGII: **200 ms**) | La nota del vault sugería "5-15 min", excesivo frente al dato oficial de 200 ms | Polling fijo | Saturar el servicio si no hay backoff | `[Descripcion-tecnica, págs. 19-20, alta]` |

---

## 5. Flujo completo de facturación electrónica

Flujo end-to-end para e-CF general (tipos 31, 33, 34, y 32 ≥ RD$250,000). Las variantes RFCE y contingencia se indican al final.

| # | Paso | Entrada | Salida | Validaciones | Errores posibles | Módulo | Se persiste | Fuente |
|---|------|---------|--------|--------------|------------------|--------|-------------|--------|
| 1 | Recepción solicitud ERP/POS | JSON `POST /api/v1/invoices` + `Idempotency-Key` | Invoice `DRAFT` | API key válida; empresa activa; esquema JSON | 400/401/409 | 1 | Payload original, idempotency key | §6 |
| 2 | Validación de payload | Invoice DRAFT | OK / errores de campo | Tipos, longitudes (RazonSocial≤150, NombreItem≤80…), regex RNC/fecha/teléfono | ERP-VAL-* (§12) | 1 | Resultado validación | `[XSD e-CF 31, alta]` |
| 3 | Validación fiscal | Invoice validada | Invoice `VALIDATED` | Totales cuadran (tolerancia ±1/línea, global = nº líneas); redondeo 2 dec (3er dec ≥5 sube); ITBIS por indicador; exento sin ITBIS; NC 34: monto ≤ e-CF modificado; NC >30 días sin ITBIS; fecha emisión no futura | FISC-* | 2 | Detalle de reglas evaluadas | `[Informe Técnico, págs. 18, 20-21, alta]` |
| 4 | Asignación e-NCF | Empresa + tipo | e-NCF `E` + tipo + secuencia(10) | Secuencia disponible, no vencida (31/12 año sig.); asignación atómica | SEQ-* | 7 | Secuencia consumida + timestamp | `[Informe Técnico, pág. 14, alta]` |
| 5 | Construcción documento fiscal | Invoice + e-NCF | Estructura fiscal completa | Matriz de obligatoriedad por tipo (§8.2); RNCComprador según reglas del tipo (§8.2) | FISC-* | 3 | FiscalDocument | `[Formato e-CF, matriz pág. 4, alta]` |
| 6 | Generación XML | FiscalDocument | XML sin firmar | Sin tags vacíos (rechazo); escapado de 5 caracteres reservados; decimales con punto sin separador de miles; fechas dd-MM-AAAA | XML-* | 3 | XML sin firmar (versionado) | `[Descripcion-tecnica, págs. 58-59; Informe Técnico, pág. 19, alta]` |
| 7 | Validación XSD | XML | OK → `XML_GENERATED` | Contra XSD del tipo exacto (e-CF 31…47) | XML-002 | 3 | Resultado + versión XSD usada | D6 |
| 8 | Firma digital | XML + cert .p12 | XML firmado → `XML_SIGNED`; código seguridad (6) | Cert vigente; SN del cert = RNC del emisor; C14N inclusiva; `preservewhitespace=false` | SIG-*, CERT-* | 4 | XML firmado, SignatureValue, código seguridad, fecha firma | `[Firmado de e-CF; Descripcion-tecnica, pág. 60, alta]` |
| 9 | Envío a DGII | XML firmado, nombre `RNCEmisor+eNCF.xml` | `trackId` → `SENT_TO_DGII` | Token vigente (refresco 50 min); multipart `xml*`; header Bearer | AUTH-DGII-*, SEND-* | 5, 9 | Request/response completos, trackId | `[Descripcion-tecnica, págs. 11-12, 59, alta]` |
| 10 | Recepción de respuesta / polling | trackId | Estado 0-4 | Backoff D10; si 3 (En Proceso) seguir; terminal: 1, 2, 4 | DGII-RESP-*, TIMEOUT-* | 9, 5 | Cada consulta + respuesta | `[Descripcion-tecnica, págs. 19-20, alta]` |
| 11 | Persistencia de estado | Estado DGII | `ACCEPTED` / `ACCEPTED_CONDITIONAL` / `REJECTED` | Mapeo §11; si 2: registrar mensajes[] y `secuenciaUtilizada` | — | 8 | DGIIResponse completa | §11 |
| 12 | Notificación al ERP/POS | Cambio de estado | Webhook `invoice.accepted` / `.rejected` | Firma HMAC del webhook; reintentos | — | 1 | WebhookEvent + entregas | §16 |
| 13 | Consulta posterior | `GET /invoices/{id}/status` | Estado actual + historial | — | — | 1 | — | §6 |
| 14 | Manejo de rechazo | Estado 2 + mensajes | Acción según `secuenciaUtilizada`: `false`→corregir y reenviar MISMO e-NCF; `true`→nuevo e-NCF (secuencia quemada) | Ver 7 motivos que queman secuencia (§10.4) | SEQ-002 | 8, 7 | Motivos, decisión | `[Descripcion-tecnica, págs. 15-16, alta]` |
| 15 | Reintento | Job fallido | Reenvío | Idempotencia: consultar TrackIds existentes del e-NCF ANTES de reenviar (§13) | DUP-* | 9 | Cada intento | `[Descripcion-tecnica, pág. 24, alta]` |
| 16 | Anulación | Secuencias sin usar / e-CF no enviado | ANECF firmado → DGII | Solo si NO enviado a DGII ni receptor; si ya enviado → Nota de Crédito 34 | ANECF-* (§12) | 5, 7 | ANECF + respuesta | `[Formato Anulación, pág. 3, alta]` |
| 17 | Contingencia | Ver §5.1 — tres regímenes distintos, no un modo único | Según régimen: cola diferida ≤72h, o comprobantes no electrónicos Serie B ≤15 días calendario con regularización ≤30 días calendario, o almacenar y reenviar ante caída de la DGII | Declaración en OFV (humana) con modalidad Total o Parcial; leyenda obligatoria en la RI solo en el régimen de falta de conectividad | — | 9 | Evento de contingencia con tipo y alcance, e-CF diferidos | `[Instructivo-Contingencia, Feb 2026, págs. 3, 5, 6, 9, 12, alta]` |

**Variante RFCE (tipo 32 < RD$250,000)**: pasos 1-8 iguales generando el e-CF 32 completo (se conserva 10 años y se entrega RI al cliente); el envío a DGII es el **resumen RFCE** (XML propio con `CodigoSeguridadeCF`) a `fc.dgii.gov.do` — respuesta **síncrona** `{codigo, estado, mensajes, encf, secuenciaUtilizada}` sin TrackId ni polling `[Descripcion-tecnica, págs. 13-16; Formato RFCE, alta]`.

**Flujo receptor→emisor (paralelo a pasos 9-12)**: tras aceptación DGII, el emisor remite el e-CF al receptor electrónico (endpoint del directorio); el receptor responde **ARECF** (recibido/no recibido) y opcionalmente **ACECF** (aprobación/rechazo comercial, con copia a DGII). Si el receptor rechaza comercialmente → anular con NC 34. Si receptor aprueba pero DGII rechazó → el e-CF no es válido; emitir uno nuevo `[Informe Técnico, págs. 15-18, alta]`.

### 5.1 Contingencia — tres regímenes distintos

Fuente única: `Instructivo-Contingencia-FE.pdf`, Feb 2026 (provenance-locked pero externo y fuera de Git). **No existe un estado genérico `CONTINGENCY` ni un plazo compartido de `15_DAYS`.** Son tres regímenes con disparadores, obligaciones y plazos propios, y modelarlos como uno solo es un error de diseño.

| Régimen | Disparador | Obligaciones y plazos | Fuente |
|---|---|---|---|
| `OFFLINE_TRANSMISSION_CONTINGENCY` | "Falta de conectividad": el emisor puede generar e-CF pero no transmitirlos | Genera y conserva el e-CF offline; lo remite a la DGII una vez restablecida la conexión "en un plazo no mayor de setenta y dos (72) horas"; **la RI entregada al cliente debe llevar la leyenda obligatoria** "e-CF emitido en modalidad de Contingencia, el cual podrá ser consultado para su validez fiscal, a partir de las setenta y dos (72) horas." | pág. 5, punto 1 |
| `NON_ELECTRONIC_ISSUANCE_CONTINGENCY` | "Imposibilidad de emitir e-CF": el emisor no tiene capacidad técnica de emitir electrónicamente | Emite comprobantes fiscales no electrónicos autorizados (Serie B); notifica a la DGII vía Oficina Virtual; **máximo 15 días CALENDARIO**; superada la contingencia, dispone de **30 días CALENDARIO** para enviar a la DGII los e-CF que reemplacen los comprobantes no electrónicos emitidos — esos e-CF se envían **solo a la DGII, no al receptor** | pág. 5, punto 2; pág. 9, nota al pie 2; pág. 12 |
| `DGII_PLATFORM_CONTINGENCY` | Los sistemas de la DGII no están disponibles | El contribuyente almacena los e-CF y los envía una vez restablecida la comunicación; **si la caída dura más de 15 días HÁBILES** se habilita en la OFV la opción de enviar reportes de libros de ventas, compras, gastos, costos, retenciones y otros | pág. 12 |

**Los 15 días calendario del contribuyente y los 15 días hábiles de la DGII son conceptos distintos y nunca deben colapsarse en una sola constante.**

**Alcance parcial vs. total (ortogonal al régimen).** La contingencia puede afectar a la empresa completa o a una o varias sucursales. La declaración de entrada en OFV exige seleccionar la modalidad "Total" o "Parcial" `[pág. 3 Glosario; pág. 6 Paso 1]`.

**Modelo de datos futuro (no se diseña ni se implementa aquí — solo se deja constancia de que nada de lo registrado hoy debe cerrarle la puerta).** Un registro de contingencia deberá soportar como mínimo: `company_id`, `branch_id` (nullable), `contingency_type`, `scope` (`PARTIAL` o `TOTAL`), `started_at`, `resolved_at`, `deadline_at`, `status`. La clave no puede ser solo `company_id`.

---

## 6. Diseño de la API que consumirá el ERP/POS

Principio: el ERP/POS habla **JSON de negocio**, jamás XML ni conceptos DGII internos (semilla, TrackId, C14N). Base: `/api/v1`. Autenticación: `Authorization: Bearer <api-key>` por empresa (§14). Idempotencia: header `Idempotency-Key` obligatorio en POST de creación.

### 6.1 Tabla de endpoints

| Método | Ruta | Propósito | Relación con DGII |
|--------|------|-----------|-------------------|
| POST | `/api/v1/invoices` | Crear comprobante (valida, asigna e-NCF, genera+firma XML; con `autoSend:true` encola envío) | Prepara ECF/RFCE |
| GET | `/api/v1/invoices/{id}` | Detalle completo | — |
| GET | `/api/v1/invoices/{id}/status` | Estado interno + estado DGII + historial | Consulta resultado (trackId) |
| POST | `/api/v1/invoices/{id}/send` | Enviar/encolar envío a DGII | Recepción e-CF / Recepción FC |
| POST | `/api/v1/invoices/{id}/retry` | Reintento controlado tras rechazo/fallo | Consulta TrackIds + Recepción |
| POST | `/api/v1/invoices/{id}/cancel` | Cancelar: si no enviado → libera/anula secuencia (ANECF); si enviado → guía a nota de crédito | Anulación de rangos |
| GET | `/api/v1/invoices/{id}/xml?signed=true\|false` | Descargar XML | — |
| GET | `/api/v1/invoices/{id}/pdf` | Representación Impresa (QR v8) | Consulta Timbre (URL del QR) |
| GET | `/api/v1/invoices/{id}/events` | Auditoría del comprobante | — |
| POST | `/api/v1/credit-notes` / `/debit-notes` | NC (34) / ND (33) referenciando factura original | InformacionReferencia obligatoria |
| POST | `/api/v1/customers/validate` | Validar RNC/cédula estructural (+consulta DGII si disponible) | — |
| GET | `/api/v1/catalogs/tax-receipt-types` | Tipos 31-47 | Tabla oficial |
| GET | `/api/v1/catalogs/{units\|currencies\|payment-forms\|tax-codes\|provinces}` | Catálogos Tablas I-IV | `[Formato e-CF, págs. 60-87]` |
| GET | `/api/v1/sequences` / POST `/api/v1/sequences/void` | Estado de secuencias por tipo / anular rangos (ANECF) | Anulación de rangos |
| POST | `/api/v1/companies` + `/{id}/certificate` | Alta empresa emisora + carga certificado .p12 (cifrado) | — |
| GET/POST | `/api/v1/webhooks` | Configurar endpoints de webhook del ERP/POS | — |
| GET | `/api/v1/health` | Salud propia + estado servicios DGII (cacheado) | Estatus Servicios (APIKEY) |

### 6.2 Contrato del endpoint principal — `POST /api/v1/invoices`

Request (ejemplo mínimo factura de consumo):
```json
{
  "companyId": "emp_01",
  "type": 32,
  "customer": { "rnc": null, "name": "Consumidor Final" },
  "payment": { "type": 1, "forms": [{ "method": 1, "amount": 1180.00 }] },
  "lines": [
    { "name": "Producto A", "quantity": 2, "unitPrice": 500.00,
      "taxIndicator": 1, "kind": "good" }
  ],
  "autoSend": true
}
```
Response `201 Created`:
```json
{
  "id": "inv_9f8a",
  "encf": "E320000000123",
  "status": "READY_TO_SEND",
  "dgii": { "status": null, "trackId": null },
  "totals": { "gravado18": 1000.00, "itbis18": 180.00, "total": 1180.00 },
  "securityCode": null,
  "links": { "status": "/api/v1/invoices/inv_9f8a/status" }
}
```

Códigos HTTP: `201` creado · `200` consulta · `202` envío encolado · `400` payload malformado · `401/403` auth · `404` · `409` idempotencia (retorna respuesta original) o estado inválido para la acción · `422` validación fiscal fallida (lista `errors[]` con códigos §12) · `429` rate limit · `502/503` DGII no disponible (con `Retry-After`).

Reglas transversales:
- **Idempotencia**: mismo `Idempotency-Key` + mismo hash de payload → misma respuesta; mismo key + payload distinto → `409 IDEMPOTENCY_CONFLICT` (§13).
- **El ERP nunca elige el e-NCF**: lo asigna el gestor de secuencias (previene huecos y duplicados).
- Los campos JSON se mapean 1:1 a los tags del Formato e-CF (mapa completo en §8.3); campos DO-específicos (ISC, propina legal, retenciones, minería, exportación) se exponen como objetos opcionales que solo aplican a los tipos que los permiten (matriz §8.2).
- `POST /invoices/{id}/send` sobre factura ya aceptada → `409` (no reenvía; la secuencia está utilizada).

---

## 7. Contratos de datos

Convención: PK `id` (ULID), `created_at`/`updated_at` en todas. Montos `DECIMAL(18,2)`; precios unitarios `DECIMAL(20,4)` `[XSD: Decimal18D1or2 / Decimal20D1or4, alta]`.

| Modelo | Campos clave (tipo, oblig.) | Validaciones / notas | Fuente |
|--------|------------------------------|----------------------|--------|
| **Company** | `rnc` (9/11, req, unique), `razon_social` ≤150 req, `nombre_comercial` ≤150, `direccion` ≤100 req, `municipio/provincia` (Tabla III), `environment` (test\|cert\|prod), `urls_receptor` (json: recepcion, aprobacion, autenticacion) | RNC regex; URLs propias publicadas en directorio DGII | `[XSD Emisor; Descripcion-tecnica directorio, alta]` |
| **Branch** | `company_id` FK, `code`, `name`, `direccion` | Campo `Sucursal` del XML (opcional) | `[Formato e-CF, alta]` |
| **Customer** | `company_id`, `rnc` (9/11, nullable), `foreign_id` ≤20 nullable, `name` ≤150, `email` ≤80 (regex oficial), `direccion` ≤100 | RNC XOR foreign_id; obligatoriedad según tipo/monto (§8.2) | `[XSD Comprador, alta]` |
| **Invoice** | `company_id`, `type` (31-47), `encf` char(13) nullable hasta asignación, `status` (§11), `issue_date` (no futura), `payment_type` (1-3), `income_type` (01-06), `currency` + `exchange_rate` DECIMAL(?,4) opc., `totals` (json calculado), `idempotency_key`, `payload_hash`, `raw_payload` JSONB | **UNIQUE (company_id, encf)**; UNIQUE (company_id, idempotency_key) | `[Formato e-CF IdDoc, alta]` |
| **InvoiceLine** | `invoice_id`, `line_number` seq, `name` ≤80 req, `description` ≤1000, `quantity` DECIMAL, `unit_price` DECIMAL(20,4), `tax_indicator` (0-4), `good_or_service` (1/2), `discount_amount`, `surcharge_amount`, `amount` (= qty×price −desc +rec, tolerancia ±1) | Máx. 1,000 líneas (10,000 si tipo 32 <250k) | `[Informe Técnico, pág. 20; XSD Item, alta]` |
| **TaxDetail** | `invoice_id`, `tax_code` (Tabla I: 001-039), `rate`, `amount`, `kind` (itbis\|isc_esp\|isc_adv\|otro) | Tasas ISC específico se ajustan trimestralmente → tabla actualizable, no constantes | `[Formato e-CF, Tabla I, §22 R13]` |
| **Discount** | `invoice_id`, `line_number`, `type_adjust` (D/R), `value_type` (%\|monto), `value`, `amount`, `tax_indicator_scope` | Hasta 20; si mezcla tasas, obligatorio % e indicador por alcance | `[Formato e-CF §D, alta]` |
| **PaymentInfo** | `invoice_id`, `form` (1-8), `amount`; opc: `account_type` (CT/AH/OT), `account_number`, `bank` | Hasta 7 formas; forma 5 (bonos) exige tipo 32 | `[Formato e-CF, alta]` |
| **FiscalDocument** | `invoice_id` FK unique, `xml_unsigned` TEXT, `xml_signed` TEXT, `xsd_version`, `signature_value` TEXT, `security_code` char(6), `signed_at` (dd-MM-AAAA HH:mm:ss GMT-4), `file_name` (`RNC+eNCF.xml`) | Conservación 10 años | `[Descripcion-tecnica, pág. 59; Informe Técnico, alta]` |
| **DGIISubmission** | `invoice_id`, `attempt_n`, `kind` (ecf\|rfce\|anecf\|acecf), `track_id` nullable, `request_at`, `response_raw` JSONB, `http_status` | Un invoice puede tener N submissions (reenvíos) | `[Descripcion-tecnica, pág. 24, alta]` |
| **DGIIResponse** | `submission_id`, `codigo` (0-4), `estado` texto, `mensajes` JSONB `[{codigo, valor}]`, `secuencia_utilizada` bool, `fecha_recepcion` | Estados §10.5 | `[Descripcion-tecnica, alta]` |
| **Certificate** | `company_id`, `p12_encrypted` BYTEA (cifrado en reposo, §14), `password_ref` (secret manager), `subject_sn` (debe = RNC), `not_before/not_after`, `issuer` (Viafirma/Digifirma/Novofirma) | Alerta a 30/15/5 días del vencimiento; SN≠RNC → bloquear firma | `[Descripcion-tecnica, pág. 60, alta]` |
| **Sequence** | `company_id`, `ecf_type`, `range_from`, `range_to`, `next_value`, `expires_at` (31/12 año sig.; tipos 32/34 en TesteCF sin vencimiento), `status` (active\|exhausted\|expired\|voided) | Asignación con `SELECT ... FOR UPDATE`; alerta a 90/95% de consumo | `[Informe Técnico, pág. 14; Descripcion-tecnica, pág. 5, alta]` |
| **ReceivedDocument** (rol receptor) | `company_id`, `sender_rnc`, `encf`, `xml_received` TEXT, `arecf_sent` TEXT, `arecf_status` (0/1 + motivo 1-4), `acecf_status` (1/2) nullable | Alimenta `/fe/recepcion/api/ecf` | `[Formato Acuse, alta]` |
| **AuditLog** | `entity`, `entity_id`, `event`, `actor` (api-key/system/job), `data` JSONB, `at` | Append-only | §14 |
| **ContingencyEvent** *(modelo futuro, no se diseña aquí)* | `company_id`, `branch_id` FK **nullable**, `contingency_type` (`OFFLINE_TRANSMISSION_CONTINGENCY` / `NON_ELECTRONIC_ISSUANCE_CONTINGENCY` / `DGII_PLATFORM_CONTINGENCY`), `scope` (`PARTIAL` / `TOTAL`), `started_at`, `resolved_at`, `deadline_at`, `status` | Mínimo exigido por §5.1: la contingencia puede afectar a la empresa completa o a una o varias sucursales, y la declaración OFV obliga a elegir Total o Parcial. `deadline_at` se calcula por tipo (72h / 15 días calendario / 15 días hábiles) — **sin constante compartida** | `[Instructivo-Contingencia, Feb 2026, págs. 3, 5, 6, 9, 12, alta]` |
| **WebhookEvent** | `company_id`, `event_type` (§16), `payload` JSONB, `deliveries` (json: intentos, códigos, timestamps), `status` (pending\|delivered\|dead) | Firma HMAC | §16 |

---

## 8. Generación de XML y validación contra esquemas

### 8.1 Documentos XML a generar
| Documento | Raíz | Cuándo | Esquema |
|-----------|------|--------|---------|
| e-CF (10 tipos) | `ECF` | Cada comprobante | `e-CF {31..47} v.1.0.xsd` |
| Resumen FC | `RFCE` | Tipo 32 < RD$250,000 (envío a DGII) | `RFCE 32 v.1.0.xsd` |
| Acuse de recibo | `ARECF` | Al recibir e-CF de terceros (rol receptor) | `ARECF v1.0.xsd` |
| Aprobación comercial | `ACECF` | Opcional, como receptor (futuro) y en set de pruebas | `ACECF v.1.0.xsd` |
| Anulación de rangos | `ANECF` | Anular secuencias no usadas | `ANECF v.1.0.xsd` |
| Semilla firmada | `SemillaModel` | Autenticación (cada ~50 min) | `Semilla v.1.0.xsd` |

### 8.2 Estructura del e-CF y matriz de obligatoriedad
Estructura completa (secciones A-H): `Encabezado` (Version, IdDoc, Emisor, Comprador, InformacionesAdicionales, Transporte, Totales, OtraMoneda) → `DetallesItems/Item` (1..1000) → `Subtotales` (0..20) → `DescuentosORecargos` (0..20) → `Paginacion` → `InformacionReferencia` → `FechaHoraFirma` → `Signature` `[Formato e-CF, pág. 3; XSD e-CF 31, alta]`.

Obligatoriedad de secciones por tipo (1=oblig., 2=condicional, 3=opcional, 0=no corresponde) `[Formato e-CF, pág. 4, alta]`:
- `InformacionReferencia`: **obligatoria en 33 y 34** (`minOccurs=1` en XSD), condicional en el resto (código modificación 4 = reemplazo por contingencia; 5 = referencia a factura de consumo, solo tipo 31).
- Diferencias estructurales críticas por tipo `[XSDs, alta]`: **43** elimina `Comprador` completo · **34** elimina toda la forma de pago y `FechaVencimientoSecuencia` · **41/45** sin retenciones-lógica específica (45 las elimina) · **44/46** sin ITBIS (exentos) · **46** agrega bloque completo de exportación (FOB/CIF/puertos/transportista) · **47** reduce Comprador a `IdentificadorExtranjero`+`RazonSocialComprador` · Bloque `Mineria` solo en 32/33/34/46.
- **RNCComprador** (la regla condicional más importante): obligatorio en 31/41/45; en 32 solo si total ≥ RD$250,000; en 33/34 si modifican un 32 ≥250k; imposible en 43/47 `[Formato e-CF, pág. 12, alta]`.

### 8.3 Reglas del motor JSON→XML
1. **Nunca emitir tags vacíos**: campo sin valor ⇒ omitir el tag (su presencia vacía causa rechazo) `[Descripcion-tecnica, págs. 58-59, alta]`.
2. **Escapado** de `"` `&` `'` `<` `>` → `&#34; &#38; &#39; &#60; &#62;` `[Informe Técnico, pág. 19, alta]`.
3. **Decimales**: punto decimal, sin separador de miles, 2 decimales (4 en precio unitario y tipo de cambio, 3 en subcantidad) `[Informe Técnico, pág. 21, alta]`.
4. **Fechas**: `dd-MM-AAAA`; fecha-hora `dd-MM-AAAA HH:mm:ss` zona GMT-4 `[XSD FechaValidationType, alta]`.
5. **Redondeo**: 3er decimal ≥5 incrementa el 2do `[_Reglas_XML_Validaciones.md; Informe Técnico, pág. 21, alta]`.
6. **UTF-8 sin BOM**; valores sin espacios al inicio/fin `[_Validaciones_Negocio.md, alta]`.
7. **Nombre de archivo**: `RNCEmisor+eNCF.xml` (e-CF y ARECF); `RNCComprador+eNCF.xml` (ACECF) `[Descripcion-tecnica, pág. 59, media — tabla con desalineación]`.
8. Orden de tags = orden del XSD (secuencias `xs:sequence` son posicionales).
9. Plantillas versionadas por tipo + versión de formato (hoy todas 1.0); el campo `Version` del XML es fijo `1.0`.
10. Validación XSD **siempre** pre-firma; error aquí es bug interno (nunca debería llegar payload que la incumpla si la validación fiscal §5.3 está bien).

Checklist pre-envío (resumen §10.7): XSD ✓ · totales cuadran ✓ · e-NCF válido y vigente ✓ · sin tags vacíos ✓ · escapado ✓ · firmado ✓ · SN cert = RNC ✓ · nombre archivo ✓ · token vigente ✓.

### 8.4 Advertencias sobre los XSD oficiales (verificadas en los archivos)
- `IndicadorServicioTodoIncluidoType` declarado con **espacio inicial en `name`** en e-CF 31 — probar que el parser XSD elegido lo resuelva `[XSD e-CF 31, línea 476, alta]`.
- Varios tipos decimales usan `.` sin escapar en su regex — no reutilizar esos regex fuera del XSD `[XSDs, alta]`.
- `TipoMonedaType` incluye `CHY` (el ISO real del yuan es CNY) — usar el literal del XSD al enviar `[XSDs, alta]`.
- Tipos declarados y nunca usados (`EstadoRechazoType`, `SerieType` con "P" duplicada, `Interger6Type`) — ignorar, no mapear `[XSDs, alta]`.

---

## 9. Firma digital y certificados

### 9.1 Especificación (todo con fuente oficial)
| Aspecto | Valor | Fuente |
|---------|-------|--------|
| Estándar | XMLDSig (W3C xmldsig-core) | `[Firmado de e-CF, pág. 3, alta]` |
| Tipo | **Enveloped** — `Reference URI=""` (se firma TODO el documento); `Signature` como último hijo del raíz | `[Firmado de e-CF, págs. 3-5, alta]` |
| Digest | SHA-256 — `http://www.w3.org/2001/04/xmlenc#sha256` | `[Firmado de e-CF, pág. 4, alta]` |
| Firma | RSA-SHA256 — `http://www.w3.org/2001/04/xmldsig-more#rsa-sha256` (obligatorio) | `[Firmado de e-CF, págs. 3-4, alta]` |
| Canonicalización | **C14N inclusiva** `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` (NO exclusiva) | `[Firmado de e-CF, pág. 16: Java INCLUSIVE, alta]` |
| KeyInfo | Solo `X509Data > X509Certificate` (Base64 sin cabeceras PEM). `KeyValue/RSAKeyValue/Exponent` NO deben incluirse | `[Firmado de e-CF, pág. 17, alta]` |
| Whitespace | `preservewhitespace = false` antes de firmar | `[Firmado de e-CF; Descripcion-tecnica, pág. 60, alta]` |
| Certificado | .p12 (PKCS#12), "para Procedimiento Tributario", entidad autorizada INDOTEL: Viafirma, Digifirma, Novofirma | `[Firmado de e-CF, pág. 4; Solicitud Usuario Admin, pág. 4, alta]` |
| Restricción SN | El campo `SN` del certificado debe corresponder al RNC/Cédula/Pasaporte del propietario | `[Descripcion-tecnica, pág. 60, alta]` |
| Qué se firma | e-CF, semilla de autenticación, ARECF ("firmado digitalmente"), ACECF, ANECF, RFCE, Declaración Jurada de certificación | `[Descripcion-tecnica, págs. 9-10, 55; XSDs con sección Signature; Proceso Certificación paso 13, alta]` |

Estructura exacta del nodo `Signature` (orden estricto): `SignedInfo(CanonicalizationMethod, SignatureMethod, Reference(Transforms(enveloped), DigestMethod, DigestValue))` → `SignatureValue` → `KeyInfo(X509Data(X509Certificate))` `[Firmado de e-CF, pág. 4, alta]`.

### 9.2 Código de seguridad (dependencia de la firma) — `OPEN-DGII-01`

**Requisito confirmado (no está abierto).** El `CodigoSeguridad` son los **primeros seis elementos derivados del hash / `SignatureValue` de la firma digital del e-CF**, y así se enuncia tanto para el e-CF ordinario como para el RFCE:

- `Informe Técnico e-CF v1.0` (Marzo 2026), **pág. 36**: "CodigoSeguridad: corresponde a los primeros seis (6) dígitos del hash generado en el SignatureValue de la firma digital del e-CF." La misma página lo repite para la leyenda impresa ("Debe ser indicado en palabras los primeros seis (6) dígitos del hash del SignatureValue de la firma, debajo del código QR") y para el RFCE.
- `Descripción Técnica Servicios DGII` (rev. 02-01-2026), **pág. 21**: "codigoSeguridad: extraído de los primeros seis (6) dígitos ... que viene en el tag CodigoSeguridadeCF del resumen de factura"; **pág. 28**: `codigoSeguridad` aparece en el contrato de salida de ConsultaEstado.
- `Formato RFCE v1.0` (Enero 2020), **pág. 12**: campo `<CodigoSeguridadeCF>`, "6 primeros caracteres del Hash de la firma digital", tipo ALFANUM, longitud máxima 6.

**Ambigüedad abierta (`OPEN-DGII-01`).** Los documentos oficiales **no** fijan de manera inequívoca: si los seis caracteres se toman directamente del `SignatureValue` en Base64 o de un digest posterior; qué algoritmo usaría ese posible digest; si se opera sobre el texto Base64 o sobre los bytes decodificados; cuál es la codificación final; ni la lectura exacta de "dígitos" frente a "caracteres".

**Hipótesis principal — inferencia, no regla.** Los **primeros seis caracteres tomados directamente del `SignatureValue` Base64**. La apoya `Descripción Técnica Servicios Emisores Electrónicos` (rev. 02-01-2026), **pág. 5**: "En el caso de los datos del código de seguridad del QR en las representaciones impresas ... no deben utilizarse los siguientes caracteres reservados", y la tabla incluye `+` (`%2B`), `/` (`%2F`) y `=` (`%3D`). Un digest hexadecimal nunca puede contener esos caracteres, de modo que la exigencia solo tiene sentido para un substring Base64. **Esto es inferencia: debe resolverse con un fixture de certificación y no puede ascenderse a regla de producción.**

**Contexto, no contradicción viva.** La redacción "caracteres" viene de `Formato RFCE v1.0` (Enero 2020), mientras que "dígitos ... del hash generado en el SignatureValue" viene de documentos de Marzo 2026 y rev. 02-01-2026. Es una diferencia entre generaciones de documento.

**Asimetría estructural.** El XML del e-CF ordinario **no tiene** elemento de código de seguridad: allí el valor es un artefacto de impresión y de QR. El RFCE, en cambio, transmite `<CodigoSeguridadeCF>` como campo del documento.

**Alcance del bloqueo.** Solo la **generación final del valor** está bloqueada. Las URLs de timbre, la selección de ambiente, el orden de parámetros, el percent-encoding, el QR versión 8 y la construcción de la representación impresa están documentados y son construibles hoy (§25.8).

Flujo obligado: construir XML → firmar → derivar código → generar RI/PDF → enviar.

### 9.3 Implementación y pruebas
- TS: `xml-crypto` configurado con C14N inclusiva + SHA-256/RSA-SHA256; el ejemplo oficial DGII en TS implementa C14N manualmente — usarlo como referencia de verificación `[Firmado de e-CF, págs. 6-14, alta]`.
- Los ejemplos oficiales existen en C#, VB.Net, TS, Java y PHP (con parches documentados a `selective/xmldsig`) — sirven como vectores de prueba cruzada.
- Prueba de oro: firmar la semilla y autenticarse contra TesteCF (si el token llega, la cadena certificado→firma→validación DGII funciona). Sugerida como **primera integración real** del proyecto.
- Errores comunes: espacios/saltos alterados post-firma (C14N), certificado con SN distinto del RNC, cert vencido, KeyInfo con elementos extra.

### 9.4 Brechas de firma (los documentos NO especifican)
Vigencia del certificado y renovación · validaciones exactas de firma del lado DGII y sus códigos de error · recomendaciones oficiales de custodia de llave privada (adoptamos las propias en §14) `[Firmado de e-CF / Instructivo App, brechas confirmadas, alta]`.

---

## 10. Integración con DGII

### 10.1 Ambientes
| Ambiente | Uso | Base URLs | Notas |
|----------|-----|-----------|-------|
| **TesteCF** (Pre-Certificación) | Desarrollo/adecuación | `https://ecf.dgii.gov.do/testecf/{servicio}` · `https://fc.dgii.gov.do/testecf/{servicio}` | Envíos retenidos 60 días; secuencias 1–10M (32: 1–50M); ⚠️ vencimiento secuencias 31-12-2025 según doc 2023 (§22 R12) |
| **CerteCF** (Certificación) | Set de pruebas formal | `https://ecf.dgii.gov.do/certecf/{servicio}` | Varios servicios sin URL CerteCF pública documentada |
| **eCF** (Producción) | Validez fiscal | `https://ecf.dgii.gov.do/ecf/{servicio}` · `https://fc.dgii.gov.do/ecf/{servicio}` | — |

Cada base expone Swagger en `/help/index.html` `[Descripcion-tecnica, págs. 5-6, alta]`.

**No existe una `DGII_BASE_URL` única.** Cada servicio cuelga de su propia raíz y de su propio prefijo por ambiente, y algunos viven en otro host: los timbres son `https://ecf.dgii.gov.do/{testecf|certecf|ecf}/consultatimbre` y `https://fc.dgii.gov.do/{testecf|certecf|ecf}/consultatimbrefc` `[Descripción Técnica Servicios DGII, rev. 02-01-2026, págs. 40-41 y 42-43]`, la consulta de TrackIds cuelga de `.../consultatrackids/api/trackids/consulta`, y la recepción RFCE vive en `fc.dgii.gov.do`. Esto refuerza la decisión P0 ya tomada: configuración `DGIIServiceEndpoints` **por servicio y por ambiente** (§25.8).

### 10.2 Autenticación (por empresa+ambiente, caché 50 min)
1. `GET {base}/autenticacion/api/autenticacion/semilla` → XML `SemillaModel {valor, fecha}`.
2. Firmar la semilla (XMLDSig §9).
3. `POST {base}/autenticacion/api/autenticacion/validarsemilla` — multipart `xml*` → `{token, expira, expedido}` (fechas `yyyy-MM-ddTHH:mm:ssZ`; RFC 6750).
4. Usar `Authorization: Bearer {token}` en todos los servicios `[Descripcion-tecnica, págs. 9-10, alta]`.

### 10.3 Catálogo completo de servicios DGII

| Servicio | Método + Recurso | Ambientes documentados | Entrada → Salida |
|----------|------------------|------------------------|------------------|
| Recepción e-CF | POST `/recepcion/api/facturaselectronicas` | Test/Cert/Prod | multipart `xml*` → `{trackId, error, mensaje}` |
| Recepción RFCE | POST `fc…/recepcionfc/api/recepcion/ecf` | Test/Prod | multipart → `{codigo, estado, mensajes[], encf, secuenciaUtilizada}` (síncrono) |
| Consulta Resultado (emisor) | GET `/consultaresultado/api/consultas/estado?trackid=` | Test/Cert/Prod | → `{trackId, codigo 0-4, estado, rnc, eNCF, secuenciaUtilizada, fechaRecepcion, mensajes[]}` |
| Consulta Estado (emisor/receptor) | GET `/consultaestado/api/consultas/estado?rncemisor=&ncfelectronico=&rnccomprador=&codigoseguridad=` | Test/Prod | → estado 0/1/2 + montos/fechas |
| Consulta TrackIds | GET `/consultatrackids/api/trackids/consulta?rncemisor=&encf=` | Test/Prod | → lista `[{trackId, estado, fechaRecepcion}]` |
| Consulta RFCE | GET `fc…/consultarfce/api/Consultas/Consulta?RNC_Emisor=&ENCF=&Cod_Seguridad_eCF=` | Solo Prod documentado | → `{rnc, encf, codigo, estado, mensajes}` |
| Aprobación Comercial (envío a DGII) | POST `/aprobacioncomercial/api/aprobacioncomercial` | Test/Cert/Prod | multipart ACECF → `{mensaje[], estado 1/2, codigo}` |
| Anulación rangos | POST `/anulacionrangos/api/operaciones/anularrango` | Test/Prod | multipart ANECF → `{rnc, codigo, nombre, mensajes[]}` |
| Directorio | GET `/consultadirectorio/api/consultas/listado` · `/obtenerdirectorioporrnc?RNC=` | Test/Prod | → `[{nombre, rnc, urlRecepcion, urlAceptacion, urlOpcional}]` |
| Consulta Timbre (QR) | GET `https://ecf.dgii.gov.do/{testecf\|certecf\|ecf}/consultatimbre` — orden de concatenación `RncEmisor`, `RncComprador`, `ENCF`, `FechaEmision`, `MontoTotal`, `FechaFirma`, `CodigoSeguridad` | Test/Cert/Prod | página de validación (destino del QR); QR versión 8 `[rev. 02-01-2026, págs. 40-41]` |
| Consulta Timbre FC | GET `https://fc.dgii.gov.do/{testecf\|certecf\|ecf}/consultatimbrefc` — orden de concatenación `RNCEmisor`, `e-NCF`, `MontoTotal`, `CódigoSeguridad` | Test/Cert/Prod | ídem (QR de consumo); QR versión 8 `[rev. 02-01-2026, págs. 42-43]` |
| Emisor-Receptor (simulador) | 6 endpoints bajo `testecf/emisorreceptor` | Solo TesteCF | Simula contraparte para probar acuses/aprobaciones |
| Estatus Servicios | GET `statusecf.dgii.gov.do/api/estatusservicios/{obtenerestatus\|obtenerventanasmantenimiento\|verificarestado?ambiente=1\|2\|3}` | Único dominio | ⚠️ Auth distinta: `Authorization: Apikey …` (APIKEY entregada por DGII, requisitos no documentados) |

`[Descripcion-tecnica, págs. 9-51, v1.6, alta]`

### 10.4 `secuenciaUtilizada` — decisión de reuso del e-NCF tras rechazo
`false` → el e-NCF **puede reutilizarse** (corregir y reenviar el mismo). `true` → quemado (emitir nuevo). Motivos que la DGII asocia: certificado/firma inválida; estructura XML inválida; firmante no delegado; e-NCF no autorizado para el RNC; e-NCF vencido; RNC emisor no es emisor electrónico / no existe / no activo `[Descripcion-tecnica, págs. 15-16, alta]`.

### 10.5 Estados DGII (mapa completo)
| Código | Estado | Terminal | Acción |
|--------|--------|----------|--------|
| 0 | No encontrado | — | Verificar trackId/e-NCF; posible pérdida → reconciliar (§13) |
| 1 | Aceptado | ✔ | `ACCEPTED`; entregar al receptor; webhook |
| 2 | Rechazado | ✔ | `REJECTED`; evaluar `secuenciaUtilizada`; corregir |
| 3 | En Proceso | — | Seguir polling (D10); promedio 200 ms |
| 4 | Aceptado Condicional | ✔ | `ACCEPTED_CONDITIONAL` — **válido fiscalmente**; registrar observaciones para corregir a futuro |

### 10.6 Servicios que NUESTRO sistema debe exponer (estándar emisor-receptor)
Obligatorio para certificación (paso 1 del set pide URL Recepción/Aprobación/Autenticación): REST, HTTPS/SSL, rutas case-insensitive, disponibilidad pública permanente `[Descripcion-tecnica, pág. 52 ss., alta]`:
- `GET /fe/autenticacion/api/semilla` + `POST /fe/autenticacion/api/validacioncertificado` (opcional pero recomendado).
- `POST /fe/recepcion/api/ecf` → valida XSD/firma/RNC y responde **ARECF firmado** (Estado 0 Recibido / 1 No Recibido + motivo 1-4).
- `POST /fe/aprobacioncomercial/api/ecf` → HTTP 200 (ok) / 400 (error).
Nota: la especificación escribe la ruta estándar con tilde (`/fe/recepción/...`) y el simulador sin tilde — implementar **sin tilde** y aceptar ambas si es posible (§22 R14).

### 10.7 Checklists
**Antes de enviar**: token vigente · e-NCF asignado y no vencido · XSD ok · firmado (SN=RNC) · nombre `RNC+eNCF.xml` · no existe TrackId previo Aceptado para ese e-NCF (§13) · servicio disponible (Estatus/ventanas de mantenimiento).
**Después de enviar**: persistir trackId + request/response · programar polling · en terminal: persistir DGIIResponse, disparar webhook, actualizar secuencia si quemada · si receptor electrónico: remitir e-CF y esperar ARECF · archivar XML firmado 10 años.

### 10.8 Límites documentados y no documentados
Documentados: umbral RFCE RD$250,000 · token 1h · validación ~200 ms · retención TesteCF 60 días · máx. líneas 1,000/10,000 · ventanas de mantenimiento consultables. **No documentados** (brechas → §23): tamaño máximo de payload, timeouts HTTP, rate limits, política oficial de reintentos `[Descripcion-tecnica, "No cubierto", alta]`.

---

## 11. Estados internos de la factura

Se agrega `ACCEPTED_CONDITIONAL` al set propuesto originalmente (el estado DGII 4 es terminal y **válido fiscalmente** — no modelarlo causaría pérdida de información) `[Descripcion-tecnica, pág. 20, alta]`.

```text
DRAFT → VALIDATED → XML_GENERATED → XML_SIGNED → READY_TO_SEND → SENT_TO_DGII
SENT_TO_DGII → ACCEPTED | ACCEPTED_CONDITIONAL | REJECTED | FAILED
REJECTED/FAILED → RETRY_PENDING → SENT_TO_DGII (mismo e-NCF si secuenciaUtilizada=false)
REJECTED → DRAFT' (nuevo e-NCF si secuenciaUtilizada=true; el original queda REJECTED)
DRAFT..READY_TO_SEND → CANCELLED (libera secuencia → candidata a ANECF)
* → OFFLINE_TRANSMISSION_CONTINGENCY (cola diferida ≤72h) → READY_TO_SEND al reestablecerse
* → DGII_PLATFORM_CONTINGENCY (almacenar y reenviar) → READY_TO_SEND al reestablecerse
(NON_ELECTRONIC_ISSUANCE_CONTINGENCY no es un estado de esta máquina: no se emite e-CF, se emiten comprobantes Serie B y se regularizan después — §5.1)
```

| Estado | Cómo se llega | Permite | Bloquea | Estado DGII equiv. | Respuesta al ERP/POS |
|--------|---------------|---------|---------|--------------------|-----------------------|
| DRAFT | POST /invoices | editar, validar, cancelar | enviar | — | `draft` |
| VALIDATED | Validación fiscal ok | generar XML, cancelar | editar montos | — | `validated` |
| XML_GENERATED | XSD ok | firmar | editar | — | `processing` |
| XML_SIGNED | Firma ok + código seguridad | generar RI, encolar | editar, re-firmar | — | `processing` |
| READY_TO_SEND | RI generada / autoSend | enviar | editar | — | `ready` |
| SENT_TO_DGII | POST recepción ok (trackId) | polling, consultar | reenviar mientras 3 | 3 En Proceso | `sent` |
| ACCEPTED | Código 1 | entregar receptor, NC/ND futura | modificar, cancelar (→NC 34) | 1 | `accepted` |
| ACCEPTED_CONDITIONAL | Código 4 | igual que ACCEPTED + revisar observaciones | modificar | 4 | `accepted_conditional` + `warnings[]` |
| REJECTED | Código 2 | retry (según secuenciaUtilizada) | entregar receptor | 2 | `rejected` + `errors[]` |
| FAILED | Error técnico (red, 5xx, timeout) | retry automático | — | — | `failed` (transitorio) |
| RETRY_PENDING | Programación de reintento | — | envío manual paralelo | — | `retry_pending` + `next_attempt_at` |
| CANCELLED | Cancelación pre-envío | anular secuencia (ANECF) | todo lo demás | — | `cancelled` |
| OFFLINE_TRANSMISSION_CONTINGENCY | Falta de conectividad declarada (§5.1) | acumular; transmitir en ≤72h al restablecerse; RI con la leyenda obligatoria | polling | — | `contingency_offline_transmission` |
| DGII_PLATFORM_CONTINGENCY | Servicios DGII no disponibles (§5.1) | almacenar; reenviar al restablecerse la comunicación | polling | — | `contingency_dgii_platform` |

Cada transición registra evento en AuditLog y dispara el webhook correspondiente (§16). Transiciones no listadas = inválidas (la máquina las rechaza con `409`).

---

## 12. Manejo de errores

Formato de código interno: `CAT-NNN`. Columna "Visible ERP" = se devuelve en `errors[]` del API.

| Código | Descripción | Causa | Acción recomendada | ¿Reintentar? | Visible ERP | Fuente |
|--------|-------------|-------|--------------------|--------------|-------------|--------|
| **1. Validación de payload** |||||||
| ERP-VAL-001 | Campo requerido ausente | Payload incompleto | Corregir en ERP | No | Sí | XSD |
| ERP-VAL-002 | Longitud/formato inválido (RNC, email, teléfono, fecha) | Regex XSD | Corregir | No | Sí | `[XSD, alta]` |
| ERP-VAL-003 | Tipo e-CF no soportado/inactivo | Tipo fuera de 31-47 o no habilitado | Corregir | No | Sí | `[Informe Técnico]` |
| **2. Fiscales** |||||||
| FISC-001 | Totales no cuadran (excede tolerancia ±1/línea, global=nº líneas) | Cálculo ERP erróneo | Recalcular server-side y comparar | No | Sí | `[Informe Técnico, págs. 20-21, alta]` |
| FISC-002 | ITBIS inconsistente con IndicadorFacturacion | Ítem exento con ITBIS, etc. | Corregir indicador | No | Sí | `[_Validaciones_Negocio.md]` |
| FISC-003 | RNCComprador requerido para el tipo/monto | 32 ≥250k sin RNC; 31/41/45 sin RNC | Solicitar RNC | No | Sí | `[Formato e-CF, pág. 12, alta]` |
| FISC-004 | NC 34 excede monto del e-CF modificado | Monto NC > original | Ajustar | No | Sí | `[Formato e-CF, alta]` |
| FISC-005 | NC fuera de 30 días con devolución de ITBIS | Plazo Art. 8/28 Regl. 293-11 | Emitir sin ITBIS | No | Sí | `[Informe Técnico, pág. 18, alta]` |
| FISC-006 | Fecha de emisión inválida (futura) | Reloj ERP | Corregir | No | Sí | `[_Validaciones_Negocio.md]` |
| FISC-007 | Referencia (NCFModificado) ausente en 33/34 | Falta factura original | Incluir referencia | No | Sí | `[XSD 33/34 minOccurs=1, alta]` |
| **3. XML** |||||||
| XML-001 | Error de construcción (tag vacío detectado) | Bug de mapeo | Alertar dev; no enviar | No | No | `[Descripcion-tecnica, pág. 58]` |
| XML-002 | Validación XSD fallida | Estructura/orden/valor | Alertar dev (bug interno) | No | No | D6 |
| XML-003 | Caracteres sin escapar | Datos crudos | Escapar y regenerar | Auto | No | `[Informe Técnico, pág. 19]` |
| **4. Firma** |||||||
| SIG-001 | Fallo al firmar (llave/librería) | .p12 corrupto, password | Verificar certificado | No | Genérico | §9 |
| SIG-002 | Firma no verifica localmente | C14N/whitespace alterado | Revisar pipeline (no tocar XML post-firma) | No | No | `[Firmado de e-CF]` |
| **5. Autenticación DGII** |||||||
| AUTH-DGII-001 | Semilla no obtenida | Servicio caído | Backoff + Estatus Servicios | Sí | No | §10.2 |
| AUTH-DGII-002 | validarsemilla rechazada | Firma semilla inválida, cert no delegado | Verificar cert/delegación en OFV | No | Genérico | §10.2 |
| AUTH-DGII-003 | Token expirado (401) | >1h | Renovar y reintentar 1 vez | Auto | No | `[Descripcion-tecnica, pág. 10]` |
| **6. Envío** |||||||
| SEND-001 | HTTP 5xx / conexión rechazada | DGII indisponible | Backoff exponencial; si persiste → `DGII_PLATFORM_CONTINGENCY` (almacenar y reenviar; el umbral de 15 días **hábiles** habilita reportes por OFV). Si la falla es de conectividad propia → `OFFLINE_TRANSMISSION_CONTINGENCY` (≤72h). Ver §5.1 | Sí | `sent_delayed` | `[Instructivo-Contingencia, Feb 2026, pág. 5 punto 1; pág. 12]` |
| SEND-002 | Respuesta sin trackId con `error` | Archivo/estructura rechazada en recepción | Analizar `mensaje` | Según causa | Sí | `[Descripcion-tecnica, pág. 12]` |
| **7. Respuesta DGII** |||||||
| DGII-RESP-001 | Rechazado con secuenciaUtilizada=false | Corregible (7 motivos §10.4) | Corregir y reenviar MISMO e-NCF | Sí (manual) | Sí + mensajes DGII | `[Descripcion-tecnica, págs. 15-16]` |
| DGII-RESP-002 | Rechazado con secuenciaUtilizada=true | e-NCF quemado | Nuevo e-NCF | Sí (nuevo) | Sí | ídem |
| DGII-RESP-003 | Aceptado Condicional | Irregularidad no crítica | Registrar warnings; corregir patrón a futuro | No | Sí (warnings) | `[Informe Técnico, pág. 12]` |
| DGII-RESP-004 | Aprobación comercial rechazada por DGII (10 mensajes doc.) | XSD/firma/delegación/e-CF inexistente | Según mensaje | Según causa | Parcial | `[Descripcion-tecnica, pág. 28-29]` |
| **8. Timeout** |||||||
| TIMEOUT-001 | Sin respuesta al enviar (¿recibió DGII?) | Red | **No reenviar a ciegas**: Consulta TrackIds por RNC+e-NCF primero (§13) | Sí (tras verificar) | `sent_pending` | `[Descripcion-tecnica, pág. 24]` |
| TIMEOUT-002 | Polling sin estado terminal prolongado | Estado 3 persistente | Escalar alerta ops a las N horas | Sí | `processing` | D10 |
| **9. Infraestructura** |||||||
| INFRA-001 | DB caída / cola detenida | — | Alerta crítica; el POS puede seguir vendiendo (envío diferido) | Sí | 503 | — |
| **10. Duplicidad** |||||||
| DUP-001 | Idempotency-Key repetida (mismo hash) | Reintento de red del ERP | Devolver respuesta original (200/201) | — | Transparente | §13 |
| DUP-002 | Misma key, payload distinto | Bug del ERP | 409 IDEMPOTENCY_CONFLICT | No | Sí | §13 |
| DUP-003 | "Envío duplicado" (motivo ARECF 3) | Reenvío al receptor | No reenviar; verificar acuse | No | No | `[Formato Acuse, pág. 5]` |
| **11. Secuencias** |||||||
| SEQ-001 | Secuencia agotada | Rango consumido | Solicitar nuevo rango en OFV; alertar a 90% | No | Sí | `[Informe Técnico, pág. 14]` |
| SEQ-002 | Secuencia vencida (31/12 año sig.) | Vencimiento anual | Solicitar nuevas; anular vencidas no usadas | No | Sí | ídem |
| SEQ-003 | Anulación rechazada ("secuencias ya utilizadas", "Desde>Hasta", "NoLinea sin orden", 8 mensajes doc.) | Rango inválido | Corregir rango | No | Sí | `[Descripcion-tecnica, pág. 31-32]` |
| **12. Certificado** |||||||
| CERT-001 | Vencido / por vencer | Vigencia | Renovar con la entidad emisora (alertas 30/15/5 días) | No | Sí (admin) | §7 Certificate |
| CERT-002 | SN ≠ RNC del emisor | Cert equivocado | Cargar cert correcto | No | Sí (admin) | `[Descripcion-tecnica, pág. 60, alta]` |
| CERT-003 | "RNC del certificado no está delegado" | Falta delegación de rol Firmante en OFV | Completar delegación (Instructivo v2.0) | No | Sí (admin) | `[Descripcion-tecnica, pág. 28; Instructivo Delegaciones]` |

---

## 13. Idempotencia y prevención de duplicados

**Capa ERP→API**: header `Idempotency-Key` (UUID) obligatorio en POST de creación; se persiste con `payload_hash` (SHA-256 del JSON canónico). Repetición con mismo hash → respuesta original; con hash distinto → `409`. Retención de keys: 30 días.

**Capa API→DGII** (la crítica):
1. `UNIQUE (company_id, encf)` en DB — un e-NCF jamás se asigna dos veces (asignación transaccional `FOR UPDATE`).
2. Antes de todo reenvío: `GET consultatrackids?rncemisor&encf`. La DGII **acepta múltiples envíos del mismo e-NCF y genera múltiples TrackIds** `[Descripcion-tecnica, pág. 24, alta]` — el control de duplicados es NUESTRO, no de DGII.
3. **Escenario "DGII recibió pero no vimos la respuesta"** (timeout post-POST): estado interno `SENT_UNCONFIRMED`; job de reconciliación consulta TrackIds por e-NCF: si existe TrackId → adoptarlo y hacer polling; si no existe tras N intentos → reenviar. Nunca reenviar sin esta consulta.
4. Rechazo: reusar e-NCF **solo** si `secuenciaUtilizada=false` (§10.4).
5. Reconciliación nocturna: todo invoice en estado no-terminal >24h se reconsulta (TrackIds + Consulta Estado por RNC+e-NCF).
6. Datos mínimos para reconciliar (persistidos siempre): e-NCF, todos los TrackIds con timestamps, hash del XML firmado, respuestas crudas.

---

## 14. Seguridad

| Medida | Detalle | ¿Exigido por DGII? |
|--------|---------|---------------------|
| AuthN del ERP/POS | API keys por empresa (hash en DB, prefijo identificable, rotación); OAuth2 client-credentials como evolución | No — propio |
| AuthZ por empresa | Cada key accede solo a su `company_id`; scopes (`invoices:write`, `admin`) | No — propio |
| HTTPS/SSL en todo | Obligatorio también en los servicios que exponemos | **Sí** `[Descripcion-tecnica, pág. 52, alta]` |
| Certificado digital .p12 | Cifrado en reposo (AES-256-GCM); password en secret manager (nunca en DB/env plano); acceso solo del módulo `signer`; considerar HSM/KMS en producción | Certificado sí; custodia no especificada (§9.4) — medidas propias |
| Firma con SN=RNC | Validar al cargar el certificado | **Sí** `[Descripcion-tecnica, pág. 60]` |
| Delegación de roles | Firmante delegado en OFV antes de operar (error CERT-003 si falta) | **Sí** `[Instructivo Delegaciones v2.0]` |
| Cifrado en tránsito interno | TLS a DB/colas si hay red compartida | No — propio |
| Logs sin datos sensibles | Nunca loggear .p12, passwords, tokens DGII, API keys; XML crudo solo en almacenamiento de auditoría con acceso restringido | No — propio |
| Auditoría append-only | AuditLog inmutable (sin UPDATE/DELETE) | Trazabilidad implícita en obligación de conservación 10 años |
| Rate limiting | Por API key (p.ej. 100 req/min) + circuito hacia DGII | No — propio |
| Separación de ambientes | `environment` por empresa; credenciales/URLs separadas; PROHIBIDO certificado de producción en TesteCF si el mismo cert sirve para ambos — usar configuración explícita | Ambientes sí `[Descripcion-tecnica, pág. 5]` |
| APIKEY Estatus Servicios | Secret manager; distinto del Bearer | **Sí** para ese servicio `[Descripcion-tecnica, pág. 47]` |
| Webhooks firmados | HMAC-SHA256 con secret por endpoint (§16) | No — propio |

---

## 15. Base de datos

Modelo relacional (PostgreSQL; tablas = modelos de §7). Claves de diseño:

```text
companies 1─n branches
companies 1─n customers
companies 1─n certificates (activo = 1)
companies 1─n sequences (por ecf_type)
companies 1─n invoices 1─n invoice_lines
                        1─n payment_infos
                        1─n discounts / tax_details
                        1─1 fiscal_documents
                        1─n dgii_submissions 1─1 dgii_responses
companies 1─n received_documents (rol receptor)
companies 1─n webhook_endpoints 1─n webhook_events
audit_logs (append-only, por entidad)
jobs (cola persistente: type, payload, run_at, attempts, status)
```

| Restricción/Índice | Tabla | Razón |
|--------------------|-------|-------|
| UNIQUE (company_id, encf) | invoices | Duplicados imposibles (§13) |
| UNIQUE (company_id, idempotency_key) | invoices | Idempotencia ERP |
| UNIQUE (company_id, ecf_type, range_from) | sequences | Rangos no solapados |
| INDEX (status, updated_at) | invoices | Jobs de polling/reconciliación |
| INDEX (track_id) | dgii_submissions | Consulta por TrackId |
| INDEX (company_id, issue_date) | invoices | Reportes |
| CHECK (encf ~ '^E(31\|32\|33\|34\|41\|43\|44\|45\|46\|47)[0-9]{10}$') | invoices | Regla de negocio (más estricta que el XSD, que solo pide 13 alfanum.) `[_Validaciones_Negocio.md + XSD, alta]` |

- **XML**: `TEXT` en `fiscal_documents` (xml_unsigned, xml_signed) + respaldo en objeto/archivo (retención 10 años; particionar por año).
- **Respuestas DGII**: crudas en JSONB (`response_raw`) — nunca solo el estado interpretado.
- **Certificados**: BYTEA cifrado + referencia a secret manager para el password; jamás en texto plano.
- **Campos de auditoría**: `created_at`, `updated_at`, `created_by` (api key) en todas; AuditLog para transiciones.
- **Multiempresa**: `company_id` NOT NULL en todas las tablas fiscales; toda query filtrada por tenant (D8).

---

## 16. Webhooks hacia el ERP/POS

| Evento | Disparo |
|--------|---------|
| `invoice.created` | Invoice creada (DRAFT/VALIDATED) |
| `invoice.validated` | Validación fiscal superada |
| `invoice.signed` | XML firmado (incluye `securityCode`, `signedAt`) |
| `invoice.sent` | TrackId recibido |
| `invoice.accepted` | Estado DGII 1 |
| `invoice.accepted_conditional` | Estado DGII 4 (incluye `warnings[]`) |
| `invoice.rejected` | Estado DGII 2 (incluye `errors[]`, `sequenceReusable`) |
| `invoice.failed` | Fallo técnico persistente |
| `invoice.retry_pending` | Reintento programado (`nextAttemptAt`) |
| `invoice.cancelled` | Cancelada pre-envío |
| `invoice.contingency` | Entró a cola de contingencia |

Payload estándar:
```json
{
  "id": "evt_01H...", "type": "invoice.accepted", "createdAt": "2026-07-02T14:03:22Z",
  "data": { "invoiceId": "inv_9f8a", "encf": "E310000000123", "companyId": "emp_01",
            "dgii": { "trackId": "…", "code": 1, "state": "Aceptado" } }
}
```
- **Seguridad**: header `X-Webhook-Signature: sha256=HMAC(secret, body)` + `X-Webhook-Timestamp` (rechazar >5 min de desfase). Secret por endpoint, rotable.
- **Entrega**: el ERP responde `2xx` en <10s; cualquier otra cosa → reintentos con backoff (1m, 5m, 30m, 2h, 12h; máx 5) → `dead` + alerta. Reentrega manual vía `POST /webhooks/events/{id}/redeliver`.
- **Orden no garantizado**: el ERP debe usar `createdAt` + estado, no asumir secuencia.
- Registro completo de entregas en `webhook_events.deliveries`.

---

## 17. Pruebas

### 17.1 Unitarias (por módulo)
- **fiscal-validator**: cuadratura con tolerancia ±1/línea y global=nº líneas (casos del ejemplo oficial: dif. 2.72 con 3 líneas = OK) `[Informe Técnico, pág. 21]`; redondeo (750.5276→750.53); ITBIS por indicador 0-4; exento sin ITBIS; NC≤original; regex e-NCF/RNC/fechas.
- **xml-engine**: mapeo JSON→XML por tipo; omisión de tags vacíos; escapado; orden de secciones; decimales/fechas.
- **signer**: estructura Signature exacta (orden, URIs de algoritmos, KeyInfo sin KeyValue); verificación local de firma; derivación de código de seguridad (cuando un fixture de certificación resuelva `OPEN-DGII-01` / §22 R6).
- **state-machine**: todas las transiciones válidas e inválidas; mapeo códigos DGII 0-4.
- **sequence-manager**: concurrencia (N asignaciones paralelas sin duplicar), agotamiento, vencimiento.
- **errores**: cada código §12 con su respuesta HTTP.

### 17.2 Integración
- API completa con DB real (testcontainers): POST /invoices → estado READY_TO_SEND con XML firmado válido.
- **dgii-client contra mock**: simulador HTTP local que replica los contratos de §10.3 (fixtures de respuestas reales del Swagger); escenarios: token expirado, 5xx, estado 3 prolongado, secuenciaUtilizada true/false.
- Cola: reintentos, backoff, reconciliación TrackIds.
- Webhooks: firma HMAC, reintentos, dead letter.
- **Servicios inbound**: POST de un e-CF de terceros → ARECF firmado correcto (estados 0/1, motivos 1-4).
- Certificados: carga .p12, SN≠RNC rechazado, expiración.

### 17.3 Contra la documentación del vault
- Validar cada XML generado contra su XSD oficial (los 10 tipos + RFCE + ARECF + ACECF + ANECF + semilla).
- Comparar RI generada contra los 12 modelos ilustrativos `[Representación Impresa, págs. 3-17]`.
- Vectores de firma cruzados con los ejemplos oficiales en 5 lenguajes `[Firmado de e-CF]`.
- QR: URL exacta de consultatimbre con los 7 parámetros (4 para FC) `[Descripción Técnica Servicios DGII, rev. 02-01-2026, págs. 40-41 y 42-43]`. Nota: la numeración heredada (págs. 36-39) corresponde a la Descripción Técnica anterior a la segregación del 02-01-2026.

### 17.4 Certificación DGII (preparación del set de 14 pasos)
Checklist operativo mapeado a `[Proceso de Certificacion..., págs. 4-21, Jul 2025, alta]`: postulación con URLs propias (paso 1) → set Excel de pruebas de datos e-CF (paso 2) → aprobaciones/rechazos comerciales (paso 3) → simulación con datos reales (paso 4) → carga de RI en PDF ≤10MB (pasos 5-6) → actualización URLs (paso 7) → pruebas de comunicación + certificado raíz (paso 8) → recepción de e-CF de DGII y acuses (paso 9) → recepción de aprobaciones (pasos 10-11) → URLs de producción (paso 12) → Declaración Jurada firmada con App Firma (paso 13) → estatus del RNC (paso 14). Criterios: e-CF Aceptado (un Rechazado obliga a reiniciar el set); AC "OK"; RI "Aprobada".
Previo al set: ejercitar TODO en TesteCF (pre-certificación), incluido RFCE en `fc.dgii.gov.do/testecf` y el simulador emisor-receptor (recordar: tipos 32/41/43/45/46/47 excluidos del simulador de emisión).

### 17.5 Casos negativos (mínimos obligatorios)
RNC inválido (8 y 10 dígitos, letras) · receptor incompleto para tipo 31 · totales descuadrados fuera de tolerancia · ITBIS 18% calculado al 16% · ítem exento con ITBIS · XML con tag vacío inyectado · XML alterado post-firma (1 byte) · certificado vencido / SN≠RNC · timeout DGII en POST (verificar reconciliación TrackIds, no reenvío ciego) · rechazo con secuenciaUtilizada=true y false · envío duplicado del mismo e-NCF · secuencia agotada en concurrencia · NC 34 > monto original · NC a los 31 días con ITBIS · e-NCF vencido · Idempotency-Key repetida con payload distinto.

Cobertura objetivo: ≥80% en módulos fiscales/XML/firma (los módulos 2-4 son el corazón del sistema).

---

## 18. Roadmap por fases

> Formato por fase: **Objetivo · Entregables · Tareas · Dependencias · Criterios de aceptación · Riesgos · Fuentes · Prompt sugerido para el agente**.

### Fase 0 — Auditoría del vault y cierre de brechas
- **Objetivo**: resolver las ambigüedades bloqueantes ANTES de codificar.
- **Entregables**: §22 con resolución por ítem; respuestas a §23; decisión de stack ratificada; verificación visual de las 3 tablas con artefactos de extracción (§2.4).
- **Tareas**: cotejar pág. 58 de Descripción Técnica (tabla caracteres QR) y Anexo I de Anulación contra el PDF visual; obtener un fixture de certificación que fije la derivación exacta del código de seguridad (`OPEN-DGII-01`: emitir en TesteCF y contrastar por consultatimbre, o consulta a DGII) sin ascender la hipótesis Base64 a regla; verificar vigencia del ambiente TesteCF y sus secuencias (§22 R12); confirmar Usuario Administrador y delegaciones en OFV; verificar si existe en el portal DGII una revisión posterior a la 02-01-2026 de la Descripción Técnica (que a partir de esa revisión está segregada en Servicios DGII y Servicios Emisores Electrónicos, motivo del corrimiento de páginas heredado).
- **Dependencias**: ninguna. **Criterios**: ninguna brecha CRÍTICA abierta sin plan.
- **Riesgos**: respuestas de DGII lentas → arrancar Fases 1-3 en paralelo (no dependen de las brechas).
- **Prompt**: *"Lee §22 y §23 del roadmap. Para cada brecha marcada CRÍTICA, ejecuta la acción recomendada (verificación en PDF original con lectura visual de la página indicada, prueba empírica en TesteCF, o pregunta redactada para DGII). Actualiza la tabla §22 con lo resuelto. No modifiques código."*

### Fase 1 — Diseño funcional y técnico
- **Objetivo**: convertir §4-§7 en diseño ejecutable (repos, módulos, contratos internos).
- **Entregables**: repo con estructura de módulos (§4.1); ADRs de D1-D10; esquema OpenAPI 3 de §6; DDL inicial de §15.
- **Tareas**: scaffolding TS (o el stack ratificado en Fase 0); linting/CI; definición de interfaces entre módulos; elección de librerías XML/firma con spike de validación (ver Fase 6).
- **Dependencias**: Fase 0 (parcial). **Criterios**: `openapi.yaml` validado; migraciones corren; CI verde.
- **Fuentes**: §4, §6, §15.
- **Prompt**: *"Con §4, §6 y §15 del roadmap como especificación, crea el esqueleto del proyecto: módulos como paquetes, OpenAPI 3 completo de los endpoints §6.1, migraciones SQL de §15, y ADRs para las decisiones D1-D10. TDD: configura el runner de tests primero. No implementes lógica de negocio aún."*

### Fase 2 — Contratos API ERP/POS
- **Objetivo**: API pública funcional con validación de payload e idempotencia (sin DGII aún).
- **Entregables**: endpoints §6.1 operativos con stubs; idempotencia completa; errores §12 categorías 1 y 10.
- **Tareas**: auth por API key; middleware Idempotency-Key + payload_hash; validación JSON Schema derivada de los XSD (longitudes/regex §7); catálogos (Tablas I-IV como seeds).
- **Dependencias**: Fase 1. **Criterios**: tests de contrato del OpenAPI en verde; DUP-001/002 cubiertos.
- **Fuentes**: §6, §13; `[Formato e-CF, Tablas I-IV]`.
- **Prompt**: *"Implementa los endpoints de §6.1 con validación de payload (§12 cat. 1) e idempotencia (§13, DUP-001/DUP-002). Los catálogos se cargan de seeds generados desde §25.2-§25.6. Tests primero (RED), implementación después (GREEN). El envío a DGII es un stub que encola."*

### Fase 3 — Modelo de datos y persistencia
- **Objetivo**: §15 completo con las restricciones de unicidad y el gestor de secuencias atómico.
- **Entregables**: todas las tablas + repositorios; `sequence-manager` con asignación `FOR UPDATE`; AuditLog.
- **Tareas**: migraciones; repositorios con tests de concurrencia (100 asignaciones paralelas → 0 duplicados); CHECK del e-NCF.
- **Dependencias**: Fase 1. **Criterios**: test de concurrencia verde; UNIQUE(company_id, encf) probado.
- **Fuentes**: §7, §15; `[Informe Técnico, pág. 14]`.
- **Prompt**: *"Implementa el DDL de §15 y el sequence-manager (§4.1-7): asignación atómica de e-NCF E+tipo+secuencia(10), vencimiento 31/12 del año siguiente, alertas a 90/95%, estados active/exhausted/expired/voided. Test obligatorio: N asignaciones concurrentes sin duplicados ni huecos."*

### Fase 4 — Validaciones fiscales
- **Objetivo**: motor de reglas §5.3 completo.
- **Entregables**: `fiscal-validator` con todas las reglas FISC-* (§12 cat. 2); matriz de obligatoriedad por tipo (§8.2) como datos, no código.
- **Tareas**: cálculo server-side de totales con decimal.js (D7); tolerancias; redondeo oficial; reglas condicionales (RNCComprador por tipo/monto, NC/ND, forma pago 5→tipo 32).
- **Dependencias**: Fase 3. **Criterios**: los 16 casos negativos de §17.5 aplicables pasan; ejemplo oficial de tolerancia (2.72/3 líneas) reproduce el resultado del Informe Técnico.
- **Fuentes**: `[Informe Técnico, págs. 18-21]`, `[Formato e-CF, §5 de este roadmap]`, `[_Validaciones_Negocio.md]`.
- **Prompt**: *"Implementa fiscal-validator según §5 paso 3, §8.2 y §12 categoría 2 del roadmap. La matriz de obligatoriedad por tipo va en un archivo de datos (JSON) generado desde la tabla de §8.2. Aritmética exclusivamente con decimal.js. Casos de prueba: §17.1 y §17.5. Cita en comentarios la fuente de cada regla no obvia."*

### Fase 5 — Generación XML
- **Objetivo**: JSON→XML para los 10 tipos + RFCE + ARECF + ACECF + ANECF + semilla, validando contra XSD.
- **Entregables**: `xml-engine` con plantillas por tipo; validador XSD integrado; reglas §8.3.
- **Tareas**: mapeo campo a campo (usar §25.7 como referencia); resolver la anomalía del espacio en `name` del XSD 31 (§8.4); fixtures de XML esperado por tipo.
- **Dependencias**: Fase 4. **Criterios**: XML de cada tipo valida contra su XSD oficial; cero tags vacíos; escapado correcto (test con `Ñ&<>'"`).
- **Fuentes**: §8; `[XSDs]`; `[Formato e-CF completo]`.
- **Prompt**: *"Implementa xml-engine según §8 del roadmap. Los XSD oficiales están en `01_Projects/DGII_Facturacion/Resources/`. Reglas §8.3 son obligatorias (tags vacíos = bug). Atención a las 4 advertencias de §8.4. Tests: cada tipo genera XML que valida contra su XSD; RFCE para tipo 32 <250,000; ARECF/ACECF/ANECF completos."*

### Fase 6 — Firma digital
- **Objetivo**: firma XMLDSig verificable por DGII.
- **Entregables**: `signer` (§9); carga segura de certificados; derivación del código de seguridad (solo tras el fixture de `OPEN-DGII-01`; §9.2); **spike validado contra TesteCF** (firmar semilla → obtener token real).
- **Tareas**: configurar xml-crypto (C14N inclusiva, RSA-SHA256, KeyInfo mínimo); comparar salida contra los ejemplos oficiales; validación SN=RNC; cifrado del .p12.
- **Dependencias**: Fase 5; certificado digital real disponible (trámite humano, iniciar YA — ver Próximas acciones).
- **Criterios**: token obtenido de TesteCF con semilla firmada (la prueba de oro §9.3); estructura Signature idéntica a la oficial.
- **Riesgos**: xml-crypto insuficiente → plan B: port del ejemplo TS oficial (C14N manual) o microservicio .NET para firmar (D1).
- **Fuentes**: §9; `[Firmado de e-CF completo]`.
- **Prompt**: *"Implementa signer según §9 del roadmap. La estructura del nodo Signature debe ser EXACTAMENTE la de §9.1 (sin KeyValue en KeyInfo). Criterio de aceptación innegociable: autenticarse contra TesteCF real (GET semilla → firmar → POST validarsemilla → token). Si xml-crypto no reproduce la C14N inclusiva esperada, porta la implementación TS oficial del PDF Firmado de e-CF."*

### Fase 7 — Integración DGII
- **Objetivo**: `dgii-client` completo (§10.3) + servicios inbound (§10.6).
- **Entregables**: cliente con los 13 servicios; caché de token 50 min; endpoints `/fe/recepcion/api/ecf` y `/fe/aprobacioncomercial/api/ecf` públicos que emiten ARECF firmado / 200-400.
- **Tareas**: multipart correcto; nombres de archivo §8.3.7; manejo de estados 0-4; flujo RFCE síncrono; anulación; directorio; Estatus Servicios con APIKEY (solicitarla a DGII — requisitos no documentados, §23).
- **Dependencias**: Fase 6. **Criterios**: e-CF 31 y 32 (y RFCE) aceptados en TesteCF; ANECF de rango de prueba aceptado; simulador emisor-receptor completado (acuse recibido y generado).
- **Fuentes**: §10; `[Descripcion-tecnica completo]`.
- **Prompt**: *"Implementa dgii-client y los servicios inbound según §10 del roadmap (URLs exactas de §10.3 parametrizadas por ambiente §10.1). Multipart campo `xml`, Bearer token con caché de 50 min, backoff D10. Los servicios inbound validan XSD+firma y responden ARECF firmado (§10.6). Prueba de aceptación: ciclo completo contra TesteCF incluyendo el simulador emisor-receptor."*

### Fase 8 — Estados, reintentos e idempotencia
- **Objetivo**: máquina de estados §11 + cola + reconciliación §13.
- **Entregables**: state-machine; job-queue con backoff; reconciliación por TrackIds; manejo de secuenciaUtilizada.
- **Dependencias**: Fase 7. **Criterios**: caos-test: matar el proceso tras POST sin respuesta → reconciliación adopta el TrackId sin duplicar; los 12 estados con transiciones válidas testeadas.
- **Fuentes**: §11, §13; `[Descripcion-tecnica, págs. 15-16, 24]`.
- **Prompt**: *"Implementa la máquina de estados de §11 (tabla completa de transiciones; las no listadas lanzan error) y la estrategia de idempotencia/reconciliación de §13. Incluye el job de reconciliación nocturna y el caso TIMEOUT-001 (consultar TrackIds antes de reenviar). Tests de caos incluidos."*

### Fase 9 — Webhooks y comunicación con ERP/POS
- **Objetivo**: §16 completo.
- **Entregables**: registro de endpoints, firma HMAC, reintentos con dead-letter, reentrega manual.
- **Dependencias**: Fase 8. **Criterios**: los 11 eventos disparan; verificación de firma documentada para el equipo del POS.
- **Prompt**: *"Implementa webhooks según §16: eventos, payload estándar, HMAC-SHA256 + timestamp anti-replay, backoff 1m/5m/30m/2h/12h, dead-letter y redeliver. Entrega también el snippet de verificación de firma que usará el ERP/POS."*

### Fase 10 — Seguridad y gestión de certificados
- **Objetivo**: §14 completo + ciclo de vida de certificados.
- **Entregables**: cifrado .p12 en reposo; secret manager; alertas de vencimiento 30/15/5 días; rate limiting; scopes por API key; revisión de logs (sin secretos).
- **Dependencias**: Fases 2, 6. **Criterios**: checklist §14 completo; pentest básico de la API pública y de los servicios inbound (son internet-facing obligatoriamente).
- **Prompt**: *"Audita e implementa §14 del roadmap. Presta atención especial a los servicios inbound (§10.6): son públicos por exigencia DGII — valida tamaño máximo de payload, firma y XSD antes de procesar; rate limit independiente. Ejecuta el checklist de seguridad y reporta hallazgos por severidad."*

### Fase 11 — Observabilidad, auditoría y logs
- **Objetivo**: trazabilidad total por comprobante y salud operativa.
- **Entregables**: AuditLog en todas las transiciones; métricas (tasa aceptación/rechazo, latencia DGII, profundidad de cola, secuencias restantes); alertas (cert por vencer, secuencia >90%, DGII caída, webhooks dead); dashboard mínimo; integración con Estatus Servicios/ventanas de mantenimiento.
- **Dependencias**: Fase 8. **Criterios**: dado un e-NCF, reconstruir su historia completa (request ERP → XML → firma → envíos → respuestas → webhooks) con una sola consulta.
- **Prompt**: *"Implementa observabilidad según §11 (eventos) y §14 (auditoría): AuditLog append-only, métricas y alertas listadas en la Fase 11 del roadmap. Entregable de aceptación: endpoint interno `GET /internal/trace/{encf}` que devuelve la línea de tiempo completa del comprobante."*

### Fase 12 — Testing automatizado
- **Objetivo**: cerrar §17 completo (lo no cubierto en fases previas).
- **Entregables**: suite integración con mock DGII completo; los 16+ casos negativos §17.5; cobertura ≥80% en módulos 2-4; tests E2E del flujo §5 completo.
- **Dependencias**: Fases 4-9. **Criterios**: CI verde con cobertura reportada; mock DGII reutilizable para el equipo del POS.
- **Prompt**: *"Completa la suite de §17: construye el mock del API DGII con los contratos exactos de §10.3 (todas las respuestas, estados 0-4, secuenciaUtilizada, errores documentados en §12 cat. 5-8) y ejecuta los casos negativos §17.5. Reporta cobertura por módulo; los módulos fiscal/xml/firma exigen ≥80%."*

### Fase 13 — Pruebas con DGII / certificación
- **Objetivo**: superar el set de pruebas oficial (14 pasos) y obtener la autorización.
- **Entregables**: postulación completada; sets de datos y simulación aprobados; RI aprobada; comunicación bidireccional verificada; Declaración Jurada firmada; URLs de producción registradas.
- **Tareas humanas previas**: Usuario Administrador e-CF aprobado; delegaciones de roles hechas; certificado vigente; formulario FI-GDF-016.
- **Dependencias**: TODAS las anteriores. **Criterios**: estatus "Emisor Electrónico autorizado" en OFV; menú de facturación electrónica habilitado.
- **Riesgos**: un e-CF Rechazado en pruebas de datos obliga a reiniciar el set `[Proceso de Certificacion, nota 4]` → ensayar TODO en TesteCF antes de tocar CerteCF.
- **Fuentes**: §17.4; `[Proceso de Certificacion completo]`.
- **Prompt**: *"Acompaña la ejecución del set de certificación según §17.4: para cada paso 1-14, verifica el prerequisito técnico, ejecuta/monitorea el envío, y registra el resultado con evidencia (request/response). Ante cualquier Rechazado, detén el set, diagnostica con §12 y reporta antes de continuar."*

### Fase 14 — Preparación para producción
- **Objetivo**: go-live.
- **Entregables**: secuencias e-NCF de producción autorizadas; certificado y URLs productivas configuradas; runbook de operación (incidentes DGII, contingencia, rotación de certificado); plan de rollback; monitoreo activo; documentación de integración para el POS publicada.
- **Dependencias**: Fase 13. **Criterios**: checklist §24 100%; primera factura real Aceptada; plan de contingencia ensayado (simulacro de 72h).
- **Prompt**: *"Ejecuta la preparación de producción: cambia el ambiente de la empresa a `prod` (URLs §10.1), verifica secuencias reales autorizadas, corre el checklist §24 completo marcando evidencia por ítem, y redacta el runbook de operación (incidentes DGII, contingencia §5.17, rotación de certificados)."*

---

## 19. Backlog técnico detallado

| ID | Épica | Historia/Tarea | Descripción | Prioridad | Dependencias | Criterio de aceptación | Agente sugerido |
|----|-------|----------------|-------------|-----------|--------------|------------------------|-----------------|
| B-001 | Fundaciones | Scaffolding + CI | Estructura módulos §4.1, lint, tests, CI | P0 | — | CI verde | backend |
| B-002 | Fundaciones | OpenAPI 3 | Spec completa §6 | P0 | B-001 | Spec valida; mock server arranca | arquitecto |
| B-003 | Fundaciones | Migraciones DDL | §15 completo | P0 | B-001 | Migraciones idempotentes | base de datos |
| B-004 | Fundaciones | ADRs D1-D10 | Decisiones §4.3 documentadas | P1 | — | 10 ADRs revisados | arquitecto |
| B-010 | API | Auth API keys + scopes | §14 | P0 | B-003 | 401/403 correctos | backend |
| B-011 | API | Idempotencia | Key+hash §13 | P0 | B-010 | DUP-001/002 en verde | backend |
| B-012 | API | POST /invoices + validación payload | §6.2 | P0 | B-011 | 201/400/422 | backend |
| B-013 | API | Endpoints consulta (GET id/status/xml/events) | §6.1 | P1 | B-012 | Contratos OpenAPI | backend |
| B-014 | API | Catálogos + seeds Tablas I-IV | §25.2-25.6 | P1 | B-003 | Seeds cargan 62 unidades, 17 monedas, códigos 001-039 | base de datos |
| B-015 | API | NC/ND (33/34) con referencia | InformacionReferencia obligatoria | P1 | B-012 | FISC-004/005/007 | backend |
| B-020 | Secuencias | sequence-manager atómico | §7 Sequence | P0 | B-003 | Test concurrencia 0 duplicados | base de datos |
| B-021 | Secuencias | Vencimientos y alertas | 31/12 año sig.; 90/95% | P1 | B-020 | Alertas disparan | backend |
| B-022 | Secuencias | ANECF (anulación de rangos) | §10.3 + XSD ANECF | P2 | B-052 | Rango anulado en TesteCF | XML/XSD |
| B-030 | Fiscal | Motor de totales decimal | D7; fórmulas §25.7 | P0 | B-012 | Reproduce ejemplos oficiales | backend |
| B-031 | Fiscal | Tolerancias y redondeo | ±1/línea; global | P0 | B-030 | Caso 2.72/3 líneas OK | backend |
| B-032 | Fiscal | Matriz obligatoriedad por tipo | §8.2 como datos | P0 | B-030 | 10 tipos cubiertos | backend |
| B-033 | Fiscal | Reglas condicionales RNCComprador | Por tipo/monto | P0 | B-032 | FISC-003 | backend |
| B-040 | XML | Plantilla ECF tipo 31 (referencia) | §8 | P0 | B-032 | Valida XSD 31 | XML/XSD |
| B-041 | XML | Plantillas 32/33/34 | Diferencias §8.2 | P0 | B-040 | Validan XSD | XML/XSD |
| B-042 | XML | Plantillas 41-47 | Alcance futuro; diseño ya soporta | P3 | B-040 | Validan XSD | XML/XSD |
| B-043 | XML | RFCE | Umbral 250k; CodigoSeguridadeCF | P0 | B-040, B-061 | Valida XSD RFCE | XML/XSD |
| B-044 | XML | ARECF/ACECF | Inbound + set de pruebas | P1 | B-040 | Validan XSD | XML/XSD |
| B-045 | XML | Validador XSD integrado | Con workaround §8.4 | P0 | B-040 | Los 15 XSD cargan | XML/XSD |
| B-050 | Firma | Carga segura .p12 | Cifrado + secret manager | P0 | B-003 | CERT-001/002 | seguridad |
| B-051 | Firma | XMLDSig core | §9.1 exacto | P0 | B-050 | Estructura idéntica a oficial | firma digital |
| B-052 | Firma | Spike token TesteCF | Prueba de oro | P0 | B-051 | Token real obtenido | firma digital |
| B-053 | Firma | Generación del código de seguridad | Bloqueado solo por `OPEN-DGII-01` (§22 R6); no bloquea B-090 | P0 | B-052, fixture de certificación | Verificado vía consultatimbre con fixture oficial | firma digital |
| B-060 | DGII | Cliente auth + caché token | 50 min | P0 | B-052 | AUTH-DGII-* | integración |
| B-061 | DGII | Recepción e-CF + RFCE | Multipart, nombres archivo | P0 | B-060 | trackId / respuesta síncrona en TesteCF | integración |
| B-062 | DGII | Consultas (resultado/estado/trackids/directorio) | §10.3 | P0 | B-061 | Estados 0-4 mapeados | integración |
| B-063 | DGII | Estatus Servicios + ventanas | APIKEY | P2 | B-060 | Health integra estatus | integración |
| B-064 | DGII | Servicios inbound + ARECF firmado | §10.6 | P0 | B-051 | Simulador emisor-receptor OK | integración |
| B-070 | Estados | Máquina de estados | §11 | P0 | B-061 | Transiciones inválidas → 409 | backend |
| B-071 | Estados | Cola + backoff + polling | D10 | P0 | B-070 | Caos-test | backend |
| B-072 | Estados | Reconciliación TrackIds | §13.3 | P0 | B-071 | TIMEOUT-001 | backend |
| B-073 | Estados | secuenciaUtilizada | Reuso vs quema | P0 | B-072 | DGII-RESP-001/002 | backend |
| B-080 | Webhooks | Registro + HMAC + reintentos | §16 | P1 | B-070 | 11 eventos + dead-letter | backend |
| B-090 | RI | PDF + QR v8 + composición de URLs de timbre | §25.8; modelos oficiales. **No bloqueado por `OPEN-DGII-01`**: URLs, ambientes, orden de parámetros, percent-encoding y QR v8 están documentados; el `CodigoSeguridad` entra como parámetro inyectado | P0 (certificación) | B-051 | PDF ≤10MB; URL de timbre y QR v8 correctos con un código de seguridad de prueba | backend |
| B-100 | Contingencia | Tres regímenes separados: cola diferida 72h + leyenda obligatoria en RI; Serie B ≤15 días calendario + regularización ≤30 días calendario; almacenar/reenviar ante caída DGII (>15 días hábiles habilita reportes OFV). Alcance PARTIAL/TOTAL por sucursal | §5.1 | P2 | B-071, B-090 | Simulacro por régimen; ninguna constante compartida entre los dos umbrales de 15 días | backend |
| B-110 | Seguridad | Rate limiting + hardening inbound | §14 | P1 | B-064 | Pentest básico sin críticos | seguridad |
| B-111 | Seguridad | Logs sin secretos + auditoría | §14 | P1 | B-070 | Revisión de logs limpia | seguridad |
| B-120 | Observabilidad | Métricas + alertas + trace por e-NCF | Fase 11 | P1 | B-070 | /internal/trace/{encf} | DevOps |
| B-130 | Testing | Mock DGII completo | §17.2 | P0 | B-062 | Reutilizable por POS | QA |
| B-131 | Testing | Casos negativos §17.5 | 16+ casos | P0 | B-130 | Todos en verde | QA |
| B-140 | Certificación | Trámites OFV (humano) | Usuario Admin, delegaciones, FI-GDF-016 | P0 | — | Postulación habilitada | humano + documentación |
| B-141 | Certificación | Ejecución set 14 pasos | §17.4 | P0 | Todo P0 | Autorización emitida | integración + humano |
| B-150 | Producción | Runbook + go-live | Fase 14 | P0 | B-141 | Checklist §24 | DevOps |
| B-160 | Docs | Guía de integración para el POS | §6 + webhooks + snippet HMAC | P1 | B-080 | Equipo POS integra sin soporte | documentación |

---

## 20. Prompts para equipo agéntico

Preámbulo común (incluir en todos): *"Trabajas en la API de Facturación Electrónica DGII (República Dominicana). El documento maestro es `01_Projects/DGII_Facturacion/roadmap_api_facturacion_electronica_dgii.md`. Regla 1: no inventes reglas fiscales — cada regla debe citar el roadmap o un documento del vault (`01_Projects/DGII_Facturacion/Resources/`). Regla 2: los documentos oficiales DGII mandan sobre las notas del vault. Regla 3: aritmética monetaria solo con decimal de precisión fija. Regla 4: TDD — test primero. Si un PDF debe consultarse, extrae el texto con `pdftotext` antes de leerlo."*

| Agente | Objetivo | Consulta obligatoria | Entradas → Salidas | Restricciones | Criterios |
|--------|----------|----------------------|--------------------|---------------|-----------|
| **1. Arquitecto** | Custodiar §4; revisar ADRs y límites de módulos | §4, §6, §15 del roadmap | Diseños/PRs → veredictos y ADRs | No introduce microservicios (D2); no relaja D7/D8 | Módulos sin dependencias cíclicas |
| **2. Backend API** | Fases 2, 8, 9 | §6, §11, §12, §13, §16 | OpenAPI + tickets B-01x/07x/08x → código + tests | El ERP nunca ve conceptos DGII; errores solo del catálogo §12 | Contratos OpenAPI en verde |
| **3. Base de datos** | Fase 3 | §7, §15 | DDL → migraciones + repos | UNIQUE(company_id,encf) innegociable; append-only en audit | Test concurrencia secuencias |
| **4. XML/XSD** | Fase 5 | §8 + XSDs en Resources/ + Formato e-CF PDF | FiscalDocument → XML válido | Nunca tags vacíos; nombres de tag EXACTOS del XSD; advertencias §8.4 | Cada XML valida contra XSD oficial |
| **5. Firma digital** | Fase 6 | §9 + `Firmado de e-CF.pdf` (5 ejemplos) | XML → XML firmado + código seguridad | Estructura Signature §9.1 exacta; sin KeyValue; C14N inclusiva | Token real de TesteCF |
| **6. Integración DGII** | Fase 7 | §10 + `Descripcion-tecnica` | XML firmado → trackId/estados | URLs solo de §10.3; multipart `xml`; nombres archivo §8.3.7; jamás reenviar sin consultar TrackIds | Ciclo completo TesteCF + simulador |
| **7. QA/Testing** | Fases 12-13 | §17, §12 | Código → suites + mock DGII + reporte cobertura | No debilitar tests para pasar; casos negativos completos | ≥80% módulos fiscales; set §17.5 verde |
| **8. Seguridad** | Fase 10 | §14 + §10.6 | Código/infra → hallazgos por severidad + fixes | .p12 nunca en claro; logs sin secretos; inbound endurecido | Checklist §14 completo |
| **9. DevOps** | Fases 11, 14 | Fase 11, §24 | Infra → CI/CD, métricas, alertas, runbook | Ambientes test/cert/prod aislados (§14) | /internal/trace/{encf}; checklist §24 |
| **10. Documentación** | Continuo | §6, §16, B-160 | Código → guía de integración POS, runbook, changelog | Inglés para código/API pública; español neutro para docs operativos DGII | POS integra sin soporte directo |

---

## 21. Definition of Done

El proyecto está TERMINADO cuando:
- [ ] API documentada (OpenAPI 3 publicado + guía de integración POS con webhooks y HMAC).
- [ ] Validaciones fiscales completas (§12 cat. 1-2; matriz §8.2 para los tipos del alcance).
- [ ] XML válido contra XSD oficial para 31/32/33/34 + RFCE + ARECF + ACECF + ANECF + semilla.
- [ ] Firma verificada: token real de TesteCF + set de certificación sin errores de firma.
- [ ] Integración DGII funcional: los 13 servicios §10.3 implementados (los del alcance MVP operativos).
- [ ] Manejo de errores: catálogo §12 completo con tests.
- [ ] Estados persistidos con historial y trace por e-NCF.
- [ ] Reintentos seguros (reconciliación TrackIds; caos-test verde).
- [ ] Idempotencia en ambas capas (§13).
- [ ] Logs/auditoría sin secretos, append-only, 10 años de retención XML.
- [ ] Suite automatizada: cobertura ≥80% en fiscal/xml/firma; casos negativos §17.5.
- [ ] XML comparados contra ejemplos/modelos oficiales del vault.
- [ ] Ambiente de certificación superado: **autorización de Emisor Electrónico emitida por DGII**.
- [ ] Checklist §24 completado con evidencia.
- [ ] POS conectado en producción con primera factura real Aceptada.

---

## 22. Riesgos, dudas y brechas

| ID | Riesgo/Brecha | Impacto | Evidencia en vault | Acción recomendada | Responsable |
|----|---------------|---------|--------------------|--------------------|-------------|
| R1 | Descripción Técnica: portada v1.6/Jun-2023 vs pie v1.5/May-2023; posible versión más nueva en portal DGII | Medio | `[Descripcion-tecnica, portada y pág. final]` | Verificar versión vigente en portal DGII antes de Fase 7 | Dueño/Fase 0 |
| R2 | Sin plazos oficiales para ARECF ni ACECF (solo secuencialidad) | Medio | `[Formato Acuse, pág. 3; Formato Aprobación, pág. 2]` | Preguntar a DGII (P-F2); Norma 01-2020 puede definirlos | Dueño |
| R3 | Sin timeouts, tamaños máximos ni rate limits documentados de los servicios DGII | Alto (diseño de resiliencia a ciegas) | `[Descripcion-tecnica, "No cubierto"]` | Valores defensivos propios (timeout 30s, payload ≤10MB) + pregunta P-T1 | Integración |
| R4 | Convivencia e-CF 32 completo <250k vs RFCE no aclarada (¿RFCE obligatorio o alternativo?) | Alto (flujo de consumo = corazón del POS) | `[Formato e-CF nota 48 vs Formato RFCE intro]` | Pregunta P-F1 a DGII; mientras tanto: RFCE para <250k (interpretación literal del RFCE) | Dueño/Fase 0 |
| R5 | Nota del vault dice "resumen diario" RFCE; el formato oficial es por factura (tiene eNCF individual) | Medio | `[_Flujos_Interaccion.md vs Formato RFCE]` | Seguir el oficial (por factura); corregir la nota del vault | Documentación |
| R6 | **`OPEN-DGII-01` — derivación exacta del código de seguridad.** El requisito está confirmado (primeros 6 elementos derivados del hash / `SignatureValue`, para e-CF ordinario y RFCE). Lo abierto es la operación: substring del Base64 vs. digest posterior, qué algoritmo, texto Base64 vs. bytes decodificados, codificación final, y "dígitos" vs. "caracteres" | **ALTO, no bloqueante de la RI completa.** Solo bloquea la generación final del valor; las URLs de timbre, ambientes, orden de parámetros, percent-encoding, QR v8 y construcción de la RI están documentados y son construibles hoy (§25.8) | `[Informe Técnico e-CF v1.0, Marzo 2026, pág. 36; Descripción Técnica Servicios DGII, rev. 02-01-2026, págs. 21 y 28; Formato RFCE v1.0, Enero 2020, pág. 12; Descripción Técnica Servicios Emisores Electrónicos, rev. 02-01-2026, pág. 5]` | Hipótesis principal (inferencia, no regla): primeros 6 caracteres del `SignatureValue` Base64, apoyada en la exigencia de percent-encoding del QR que reserva `+`, `/` y `=`. Resolver con **fixture de certificación** (emitir en TesteCF y contrastar por consultatimbre) o consulta a DGII (P-T3). No ascender la hipótesis a regla de producción | Firma/Fase 0 |
| R7 | ANECF: contradicción interna 8 vs 10 repeticiones máximas de DetalleAnulacion | Bajo | `[Formato Anulación, pág. 5]` | XSD dice 1..10 → usar 10 | XML/XSD |
| R8 | Anomalías en XSD oficiales: espacio en `name` (e-CF 31), regex con `.` sin escapar, `CHY`, tipos muertos | Medio (validadores pueden fallar) | `[XSDs, §8.4]` | Test de carga de los 15 XSD con la librería elegida en Fase 5 | XML/XSD |
| R9 | Notas del vault con errores confirmados (estado 3; polling 5-15 min) | Medio (si alguien implementa desde las notas) | `[_API_Endpoints_Flujos.md vs Descripcion-tecnica]` | Este roadmap ya corrige; actualizar las notas | Documentación |
| R10 | PDF oficial de RI con error de plantilla (modelo papel continuo "Consumo" titulado "Crédito Fiscal") | Bajo | `[Representación Impresa, modelo 2.3]` | Ignorar el título; seguir la estructura del modelo | — |
| R11 | El Formato e-CF cambia por bitácora SIN cambiar versión (última 09-10-2025: +Peso Colombiano) | Medio (drift silencioso de catálogos) | `[Formato e-CF, bitácora]` | Job semestral: verificar bitácora en portal DGII; catálogos como datos actualizables (no constantes) | DevOps |
| R12 | Vencimiento secuencias TesteCF: 31-12-2025 según doc de 2023 — **ya pasado** (hoy 2026-07-02) | Alto (bloquea desarrollo si no hay secuencias de prueba vigentes) | `[Descripcion-tecnica, pág. 5]` | Verificar al inicio de Fase 6/7 el estado real de TesteCF; solicitar secuencias nuevas si aplica | Integración/Fase 0 |
| R13 | Tasas ISC específico se ajustan trimestralmente por inflación | Medio | `[Formato e-CF, Tabla I, nota 82]` | Tabla de tasas con vigencias en DB, actualizable sin deploy | Base de datos |
| R14 | Ruta estándar inbound documentada con tilde (`/fe/recepción/...`) vs simulador sin tilde | Bajo | `[Descripcion-tecnica, líneas 2081 vs 1695]` | Implementar sin tilde; alias con tilde percent-encoded si el set de pruebas lo exige | Integración |
| R15 | Tabla de caracteres reservados QR y tabla de nombres de archivo con desalineación en extracción de texto | Medio | `[Descripcion-tecnica, págs. 58-59]` | Cotejo visual del PDF original (Fase 0) | Fase 0 |
| R16 | Firma de mensajes no-eCF (ARECF/ACECF/ANECF/RFCE): mismos algoritmos asumidos, no especificados por doc de firma | Bajo (XSDs incluyen Signature; asumimos §9.1) | `[Firmado de e-CF, brechas]` | Validar en simulador emisor-receptor y set de pruebas | Firma |
| R17 | "TesteCF" no aparece en docs de certificación (usan "pre-certificación"); equivalencia inferida | Bajo | `[Proceso de Certificacion, búsqueda negativa]` | Confirmado por URLs (`testecf`); sin acción | — |
| R18 | APIKEY de Estatus Servicios: requisitos de obtención no documentados | Bajo | `[Descripcion-tecnica, pág. 47]` | Pregunta P-T4 a DGII | Dueño |
| R19 | Sin cantidad fija de comprobantes del set de certificación (Excel descargable variable) | Bajo | `[Proceso de Certificacion]` | Se conoce al descargar; diseñar generador de casos flexible | QA |
| R20 | Relación exacta Usuario Administrador e-CF (Doc3) vs rol Administrador delegable (Doc4) inferida | Bajo | `[Solicitud Usuario Admin vs Instructivo Delegaciones]` | Pregunta P-C2 al gestionar OFV | Dueño |

---

## 23. Preguntas a resolver antes del desarrollo

**Negocio**
- P-N1: ¿Volumen diario estimado de facturas del POS? (dimensiona cola/DB; el diseño D4 asume <10k/día).
- P-N2: ¿Se emitirán tipos más allá de 31/32/33/34 en el primer año? (prioriza B-042).
- P-N3: ¿Cuántas empresas emisoras reales al inicio? (S3/S4).

**Fiscal**
- P-F1 (CRÍTICA): Para facturas de consumo <RD$250,000, ¿el envío del RFCE es la única vía o puede enviarse el e-CF 32 completo? (R4).
- P-F2: ¿Plazos formales para ARECF/ACECF? (¿Norma General 01-2020?) (R2).
- P-F3: ¿La emisión será siempre online, o se requiere el "Indicador de Envío Diferido" como modalidad regular?

**Técnico**
- P-T1: ¿Tamaño máximo de payload y timeout de los servicios de recepción DGII? (R3).
- P-T2: ¿Existe versión de la Descripción Técnica posterior a v1.6? (R1).
- P-T3 (`OPEN-DGII-01`): Derivación exacta del código de seguridad. El requisito está confirmado; la pregunta es la operación: ¿primeros 6 caracteres del `SignatureValue` Base64, o de un digest posterior (¿qué algoritmo, sobre el texto Base64 o sobre los bytes decodificados, con qué codificación final)? (R6, §9.2).
- P-T4: ¿Requisitos para obtener el APIKEY de Estatus Servicios? (R18).

**Certificados**
- P-C1: ¿Ya existe certificado digital de Procedimiento Tributario vigente? ¿A nombre de quién? (bloquea Fase 6).
- P-C2: ¿El Usuario Administrador e-CF está solicitado/aprobado en OFV? (B-140, R20).

**Ambientes**
- P-A1: ¿El RNC ya tiene acceso a TesteCF con secuencias de prueba vigentes? (R12).
- P-A2: ¿Las URLs inbound (recepción/aprobación) tendrán dominio propio con TLS desde el inicio? (requisito del paso 1 de postulación).

**ERP/POS**
- P-E1: ¿El POS podrá recibir webhooks (endpoint público) o solo hará polling? (§16 vs §6 status).
- P-E2: ¿El POS imprime la RI directamente (térmica) o usa el PDF de la API? (afecta B-090: papel continuo).

**Infraestructura**
- P-I1: ¿Dónde se despliega? (los servicios inbound requieren exposición pública 24/7 con TLS).
- P-I2: ¿Hay secret manager disponible (Vault/KMS/equivalente)? (B-050).

**Producción**
- P-P1: ¿Fecha objetivo de certificación? (la Ley 32-23 tiene calendario de obligatoriedad por tipo de contribuyente — verificar el plazo aplicable).
- P-P2: ¿Quién opera los trámites OFV durante certificación (humano designado)?

---

## 24. Checklist final para estar listo para probar con DGII

**Trámites (humanos)**
- [ ] RNC activo y al día en obligaciones tributarias.
- [ ] Clave OFV vigente.
- [ ] Alta de NCF (autorización de emisión).
- [ ] Certificado digital de Procedimiento Tributario vigente (.p12), SN = RNC/Cédula del representante.
- [ ] Usuario Administrador de e-CF aprobado (ANTES de solicitar ser emisor).
- [ ] Roles delegados en OFV: Firmante (y Aprobador Comercial si aplica).
- [ ] Formulario FI-GDF-016 enviado; acceso al Portal de Certificación recibido por buzón OFV.

**Técnica (previo al set de pruebas)**
- [ ] Token obtenido de TesteCF con semilla firmada (prueba de oro).
- [ ] e-CF 31 y 32 Aceptados en TesteCF; RFCE Aceptado en `fc…/testecf`.
- [ ] NC 34 y ND 33 con InformacionReferencia Aceptadas en TesteCF.
- [ ] ANECF de rango de prueba Aceptado.
- [ ] Simulador emisor-receptor completado: e-CF emitido/recibido + ARECF generado y recibido + ACECF.
- [ ] Servicios inbound públicos con TLS: `/fe/recepcion/api/ecf` responde ARECF firmado; `/fe/aprobacioncomercial/api/ecf` responde 200/400.
- [ ] RI en PDF ≤10MB con QR v8 (≥22×22mm, esquina inferior izquierda) que resuelve en consultatimbre de TesteCF.
- [ ] Código de seguridad verificado contra consultatimbre con un fixture de certificación (`OPEN-DGII-01` / R6 resuelto). La RI, el QR v8 y las URLs de timbre **no** dependen de este ítem y pueden estar listos antes.
- [ ] Los 15 XSD cargan en el validador (R8 verificado).
- [ ] Reconciliación por TrackIds probada (caos-test).
- [ ] Estados 0-4 mapeados y webhooks disparando.
- [ ] Ventanas de mantenimiento DGII consultadas e integradas al scheduler.
- [ ] Generador de casos desde el Excel del set de pruebas listo (B-141).
- [ ] App Firma Digital descargada y probada (necesaria para la Declaración Jurada del paso 13).
- [ ] URLs definitivas de producción definidas (paso 12).
- [ ] Suite §17 verde con cobertura objetivo.

---

## 25. Anexos

### 25.1 Mapa de archivos del vault
`01_Projects/DGII_Facturacion/`: MOC + 5 notas + `Resources/` (15 PDFs + 15 XSD listados en §2). `20_Areas/Desarrollo_DGII/`: 5 notas técnicas. Este roadmap: `01_Projects/DGII_Facturacion/roadmap_api_facturacion_electronica_dgii.md`.

### 25.2 Tipos de comprobantes
31 Crédito Fiscal · 32 Consumo · 33 Nota de Débito · 34 Nota de Crédito · 41 Compras · 43 Gastos Menores · 44 Regímenes Especiales · 45 Gubernamental · 46 Exportaciones · 47 Pagos al Exterior. (No existe 42.) `[Informe Técnico, págs. 13-14]`

### 25.3 Estados DGII
Por TrackId: 0 No encontrado · 1 Aceptado · 2 Rechazado · 3 En Proceso · 4 Aceptado Condicional. ARECF: 0 Recibido · 1 No Recibido (motivos: 1 Error especificación, 2 Error firma, 3 Duplicado, 4 RNC no corresponde). ACECF: 1 Aceptado · 2 Rechazado. AC en DGII: 1 Aprobada · 2 Rechazada.

### 25.4 Códigos y mensajes de error DGII documentados
- Motivos `secuenciaUtilizada` (7): firma/certificado inválido; XML inválido; firmante no delegado; e-NCF no autorizado; e-NCF vencido; RNC no emisor electrónico; RNC no existe/no activo.
- Aprobación comercial (10 mensajes): archivo no válido; no es XML; estructura inválida (2 variantes); firma inválida; RNC no delegado; factura no encontrada; AC no requerida para el tipo; AC no requerida para el e-CF; e-CF no válido; error de procesamiento.
- Anulación (8 mensajes): no es XML; firma inválida; tipo inválido; Desde>Hasta; secuencias utilizadas; anulación parcial; NoLinea sin orden; RNC no delegado.

### 25.5 Endpoints DGII
Tabla completa en §10.3 con ambientes en §10.1. Dominios: `ecf.dgii.gov.do`, `fc.dgii.gov.do`, `statusecf.dgii.gov.do`.

### 25.6 Esquemas XSD
15 archivos en `Resources/` (§2.3). Patrones clave: e-NCF `[a-zA-Z0-9]{13}` (XSD) endurecido a `E(31|32|33|34|41|43|44|45|46|47)[0-9]{10}` (negocio); RNC `[0-9]{11}|[0-9]{9}`; fecha `D-M-AAAA`; montos 18,2; precios 20,4.

### 25.7 Fórmulas de totales (resumen)
MontoItem = Precio×Cantidad −Desc +Rec → Gravado por tasa (÷(1+tasa) si ITBIS incluido) → ITBIS_n = Gravado_n × tasa_n → MontoTotal = ΣGravado + Exento + ΣITBIS + ImpAdicional → ValorPagar = MontoTotal − Avance ± SaldoAnterior. Detalle completo con las 14 reglas: `[Formato e-CF, págs. 18-27]`.

### 25.8 URLs del QR (por servicio y por ambiente — nunca una sola `DGII_BASE_URL`)

- **e-CF**: `https://ecf.dgii.gov.do/{testecf|certecf|ecf}/consultatimbre`. "Parámetros para concatenar", en este orden: `RncEmisor`, `RncComprador`, `ENCF`, `FechaEmision`, `MontoTotal`, `FechaFirma`, `CodigoSeguridad` `[Descripción Técnica Servicios DGII, rev. 02-01-2026, págs. 40-41]`.
- **FC < RD$250,000**: `https://fc.dgii.gov.do/{testecf|certecf|ecf}/consultatimbrefc`. "Parámetros para concatenar", en este orden: `RNCEmisor`, `e-NCF`, `MontoTotal`, `CódigoSeguridad` `[ídem, págs. 42-43]`.
- "Se utilizará la versión 8 de código QR" en ambos servicios `[ídem, págs. 41 y 43]`.
- Fecha de firma `dd-MM-aaaa HH:mm:ss` con espacio `%20`; los caracteres reservados de los datos del código de seguridad del QR se reemplazan por su representación hexadecimal `[Descripción Técnica Servicios Emisores Electrónicos, rev. 02-01-2026, pág. 5]`.

Estos dos servicios viven bajo raíces y hosts distintos, y no son los únicos: `consultatrackids` cuelga de otra raíz de servicio (`.../consultatrackids/api/trackids/consulta`) y la recepción RFCE vive en otro host (`fc.dgii.gov.do`). Refuerza la decisión P0 ya tomada de una configuración `DGIIServiceEndpoints` **por servicio y por ambiente**, no una URL base única.

### 25.9 Ejemplo de flujo exitoso (trazas)
1) `POST /invoices` → 201 `READY_TO_SEND`, e-NCF `E310000000001` · 2) job envía `101672919E310000000001.xml` → `{trackId:"a1b2…"}` · 3) polling → `{codigo:3}` → 2s → `{codigo:1, estado:"Aceptado"}` · 4) webhook `invoice.accepted` · 5) e-CF al receptor (directorio) → ARECF `{Estado:0}` · 6) opcional ACECF `{Estado:1}`.

### 25.10 Ejemplo de flujo rechazado
1-2) ídem · 3) polling → `{codigo:2, estado:"Rechazado", mensajes:[{codigo:"…", valor:"e-NCF vencido"}], secuenciaUtilizada:true}` · 4) webhook `invoice.rejected` con `sequenceReusable:false` · 5) ERP corrige → nuevo `POST /invoices` → nuevo e-NCF · 6) original queda `REJECTED` con traza completa.

---

## Próximas acciones recomendadas

Al terminar de leer este roadmap, en este orden:

1. **HOY — trámites humanos (camino crítico, no técnico)**: verificar/solicitar el certificado digital de Procedimiento Tributario (Viafirma/Digifirma/Novofirma), el Usuario Administrador de e-CF y el acceso a TesteCF (P-C1, P-C2, P-A1). Todo lo técnico puede esperar; estos trámites tienen semanas de latencia y bloquean la Fase 6.
2. **Ejecutar Fase 0** (1-2 días): resolver R6 (`OPEN-DGII-01`, derivación exacta del código de seguridad — con fixture, no con hipótesis), R12 (vigencia TesteCF) y R15 (cotejo visual de 2 tablas), y verificar R1 (revisión vigente de la Descripción Técnica en el portal DGII; la del snapshot actual es 02-01-2026 y ya viene segregada en dos documentos).
3. **Responder §23**: al menos las 2 preguntas CRÍTICAS (P-F1, P-T3) y las de infraestructura (P-I1, P-I2, P-A2 — los servicios inbound públicos condicionan dónde desplegar).
4. **Lanzar Fases 1-3 en paralelo** con los agentes 1/2/3 (§20): scaffolding, OpenAPI, DDL y sequence-manager no dependen de ninguna brecha abierta.
5. **Priorizar el spike de firma (B-052)** apenas exista certificado: obtener un token real de TesteCF es la validación más barata de toda la cadena criptográfica y desbloquea la Fase 7.
6. **Ensayar TODO en TesteCF antes de pisar CerteCF**: un solo e-CF rechazado en el set oficial obliga a reiniciarlo `[Proceso de Certificacion, nota 4]`.
7. Mantener este roadmap como **documento vivo**: cada brecha resuelta actualiza §22; cada decisión nueva agrega un ADR referenciado en §4.3.

