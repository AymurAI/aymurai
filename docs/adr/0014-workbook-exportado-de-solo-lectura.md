# ADR-0014 — El workbook exportado es un reporte de sólo lectura

**Fecha:** 2026-09-21 · **Estado:** aceptada

## Contexto

[ADR-0004](0004-alcance-instance-wide.md) fijó que la base de la instancia es la fuente de verdad
compartida, y [ANALYSIS](../defensoria/ANALYSIS.md) §C.2 listó *"el `.xlsx` local mutable como fuente de
verdad"* entre lo obsoleto, con §C.3 nombrándolo uno de los tres problemas de fondo. Pero ninguno de los dos
dice **qué es, entonces, el archivo exportado**, y la pregunta volvió al agregar en PR #76 seis campos que
hasta ese momento se completaban a mano por fuera de la aplicación.

La pregunta no es teórica. La implementación histórica de escritorio usaba un `.xlsx` local compartido como
almacén, con upsert por documento, y **el flujo legacy del Set de datos todavía lo hace**: el puente IPC que
lo permite (leer, escribir y abrir un workbook fijo en el disco del usuario) sigue vivo y funcionando. Para
alguien que llegue nuevo, no usarlo en el flujo de recomendaciones parece un olvido.

Dos hechos acotan las alternativas. La API sirve la propia aplicación web, así que ahí no hay problema de
origen cruzado; pero el único mecanismo por el que una aplicación web puede reabrir y reescribir un archivo
local elegido antes exige un contexto seguro, y el despliegue es HTTP sobre una red privada. Ese mecanismo es
además exclusivo de navegadores Chromium, y el permiso queda atado al perfil del navegador y a la máquina.

## Decisión

El workbook exportado es un **reporte de sólo lectura**: sale de la base, nunca entra.

- **No hay importación**, ni de planillas históricas ni como mecanismo de restauración.
- El export **no lleva columnas de identidad técnica**.
- Los **campos de seguimiento se editan dentro de la aplicación**, no en la planilla.
- Cada export es una **foto fechada** del estado de la base, identificada por un sufijo temporal.

## Consecuencias

- **El export puede ser lossy sin que eso constituya deuda.** No lleva la identidad del documento ni nada de
  la extracción, no lleva los identificadores de la recomendación ni de sus destinatarios, resuelve catálogos
  y organigrama **por nombre** —y el nombre de una unidad del organigrama no es único
  ([ADR-0002](0002-modelo-del-organigrama.md))— y la única columna que une sus dos hojas es nulable. Todo eso
  es aceptable **precisamente porque nada lo va a leer de vuelta**.
- **El sufijo temporal reemplaza cualquier ambición de actualizar un archivo en su lugar.** No se persigue
  paridad entre la aplicación web y la de escritorio en este eje: ambas descargan la misma foto.
- **La recuperación ante pérdida de la base es un problema de infraestructura, no de formato**: volumen
  persistente, respaldo periódico de la base y documentación para quien administra el sistema.
- **El puente de Excel de la aplicación de escritorio queda como superficie del flujo legacy del Set de datos
  y nada más.** No es una capacidad a aprovechar para recomendaciones: **no usarla es la decisión**.

## Alternativas consideradas

- **El Excel local editable como fuente de verdad**, que es lo que hacía la implementación histórica.
  Rechazada: dos escritores sobre el mismo archivo sin protocolo de reconciliación, y contradice ADR-0004.
- **Híbrido: la base manda, pero la aplicación actualiza en su lugar un archivo generado antes.** Rechazada:
  es la anterior disfrazada. Desde el momento en que la aplicación escribe sobre un archivo que una persona
  también edita a mano, no hay forma de saber quién ganó. En la aplicación web es además inviable sobre HTTP.
- **Round-trip: una hoja técnica con identificadores, para poder restaurar desde el workbook.** Rechazada: el
  mismo archivo se entrega explícitamente para que se trabaje aguas abajo —análisis, visualizaciones—, así
  que una hoja de identificadores va a ser borrada, reordenada o filtrada por la primera tabla dinámica. Un
  respaldo que depende de que nadie toque una hoja no es un respaldo. Un volcado de la base es lossless y de
  otro orden de costo.
