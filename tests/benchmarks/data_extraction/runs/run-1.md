# Benchmark de extracción — corrida #1

- Fecha: 2026-09-15T00:28:41.424247+00:00
- Modelo: `(default de la instancia)`
- Ground truth version: 1
- Corrida reusada de una anterior idéntica: sí

## Extracción (cantidad de destinatarios)

- Documentos evaluados: 101 / 102
- Errores de extracción: 1
- % con cantidad correcta de destinatarios: 87.1%

| Resolución | Esperado | Extraído |
|---|---|---|
| Resolucion-1849-22.-Control-de-obras-habilitaciones-y-permisos-Politicas-de-Inclusion-Social.pdf | 2 | 1 |
| 00036_R431-904_25-QUE-CONTIENE-RECOM.-Y-EXHORTACION.pdf | 4 | 5 |
| 00073_R461-104_25-QUE-CONTIENE-EXHORTACION-Y-COMUNIC.pdf | 5 | 1 |
| Resolucion-860-22.-Derechos-Laborales.pdf | 2 | 1 |
| Resolucion-2104-22.-Educacion.pdf | 1 | 2 |
| 00042_R441-898_25-QUE-CONTIENE-RECOM.-Y-COMUNICACION-1.pdf | 4 | 1 |
| Resolucion-82-22.-Migrantes.pdf | 1 | 3 |
| Real-28124.pdf | 2 | 5 |
| Reso-126924.pdf | 4 | 6 |
| Reso-132924.pdf | 5 | 6 |
| Resolucion-861-20.-Servicios-bancarios-y-financieros.pdf | 3 | 1 |
| Recomedacion-01.2022-CLPT-CABA.pdf | 4 | 0 |
| Reco-Mahiques.pdf | 2 | 4 |

## Sector macro (GCBA / Organismos Nacionales / Obra Social / Empresa)

- Destinatarios evaluados: 145
- Accuracy: 83.4%

**Matriz de confusión** (esperado → obtenido):

| Esperado → Obtenido | Conteo |
|---|---|
| Empresa → Empresa | 18 |
| Empresa → Obra Social / Prepaga | 1 |
| GCBA → GCBA | 86 |
| GCBA → None | 2 |
| Obra Social / Prepaga → Obra Social / Prepaga | 3 |
| Organismos Nacionales → None | 21 |
| Organismos Nacionales → Organismos Nacionales | 14 |

**Precision / Recall / F1 por clase:**

| Clase | Soporte | Precision | Recall | F1 |
|---|---|---|---|---|
| GCBA | 88 | 100.0% | 97.7% | 98.9% |
| Organismos Nacionales | 35 | 100.0% | 40.0% | 57.1% |
| Empresa | 19 | 100.0% | 94.7% | 97.3% |
| Obra Social / Prepaga | 3 | 75.0% | 100.0% | 85.7% |

F1 macro: 84.8% — F1 ponderado por soporte: 88.3%

## Sector fino (sólo destinatarios GCBA)

- Destinatarios evaluados: 86
- Top-1: 54.7%
- Top-3: 60.5%
- Top-5: 79.1%

**Matriz de confusión (top-1)** — sólo pares donde esperado y/u obtenido difieren se listan abajo de la diagonal implícita; ver la tabla de precision/recall/F1 para el detalle por clase:

| Esperado → Obtenido | Conteo |
|---|---|
| Agencia Gubernamental de Control - Ley N° 2.624 → Agencia Gubernamental de Control - Ley N° 2.624 | 1 |
| COPIDIS → COPIDIS | 3 |
| COPIDIS → Secretaría de Gobierno y Vínculo Ciudadano | 1 |
| Jefatura de Gabinete → Jefatura de Gabinete de Ministros | 2 |
| Jefatura de Gabinete → Ministerio de Espacio Público e Higiene Urbana | 1 |
| Jefatura de Gabinete → Ministerio de Justicia | 2 |
| Ministerio de Cultura → Ministerio de Cultura | 1 |
| Ministerio de Desarrollo Humano y Hábitat → Ministerio de Desarrollo Humano y Hábitat | 6 |
| Ministerio de Desarrollo Humano y Hábitat → Ministerio de Hacienda y Finanzas | 1 |
| Ministerio de Educación → Ministerio de Desarrollo Humano y Hábitat | 1 |
| Ministerio de Educación → Ministerio de Educación | 4 |
| Ministerio de Educación → Ministerio de Salud | 13 |
| Ministerio de Educación → Ministerio de Seguridad | 3 |
| Ministerio de Educación → Secretaría de Medios | 1 |
| Ministerio de Espacio Público e Higiene Urbana → Ministerio de Espacio Público e Higiene Urbana | 2 |
| Ministerio de Hacienda y Finanzas → Ministerio de Hacienda y Finanzas | 5 |
| Ministerio de Justicia → Ministerio de Justicia | 1 |
| Ministerio de Movilidad e Infraestructura → Ministerio de Movilidad e Infraestructura | 1 |
| Ministerio de Salud → Ministerio de Salud | 10 |
| Ministerio de Seguridad → Ministerio de Seguridad | 7 |
| Secretaría de Deporte → Ministerio de Espacio Público e Higiene Urbana | 14 |
| Secretaría de Deporte → Secretaría de Deporte | 5 |
| Secretaría de Gobierno y Vínculo Ciudadano → Secretaría de Gobierno y Vínculo Ciudadano | 1 |

**Precision / Recall / F1 por clase:**

| Clase | Soporte | Precision | Recall | F1 |
|---|---|---|---|---|
| Ministerio de Educación | 22 | 100.0% | 18.2% | 30.8% |
| Secretaría de Deporte | 19 | 100.0% | 26.3% | 41.7% |
| Ministerio de Salud | 10 | 43.5% | 100.0% | 60.6% |
| Ministerio de Desarrollo Humano y Hábitat | 7 | 85.7% | 85.7% | 85.7% |
| Ministerio de Seguridad | 7 | 70.0% | 100.0% | 82.4% |
| Jefatura de Gabinete | 5 | — | 0.0% | — |
| Ministerio de Hacienda y Finanzas | 5 | 83.3% | 100.0% | 90.9% |
| COPIDIS | 4 | 100.0% | 75.0% | 85.7% |
| Ministerio de Espacio Público e Higiene Urbana | 2 | 11.8% | 100.0% | 21.1% |
| Agencia Gubernamental de Control - Ley N° 2.624 | 1 | 100.0% | 100.0% | 100.0% |
| Ministerio de Cultura | 1 | 100.0% | 100.0% | 100.0% |
| Ministerio de Justicia | 1 | 33.3% | 100.0% | 50.0% |
| Ministerio de Movilidad e Infraestructura | 1 | 100.0% | 100.0% | 100.0% |
| Secretaría de Gobierno y Vínculo Ciudadano | 1 | 50.0% | 100.0% | 66.7% |

F1 macro: 70.4% — F1 ponderado por soporte: 55.6%

## Historial de corridas

| Run | Fecha | Modelo | Prompt hash | GT version |
|---|---|---|---|---|
| 1 (esta corrida) | 2026-09-14T23:17:22.739444+00:00 | - | 9abff1d04f | 1 |
