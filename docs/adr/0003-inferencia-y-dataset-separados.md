# ADR-0003 — Caché de inferencia y fila del dataset son entidades distintas

**Fecha:** 2026-08-27 · **Estado:** aceptada

## Contexto

La implementación histórica guardaba una fila por documento con `prediction` y `validation` como **JSON
opaco**. Sirve para cachear una inferencia, pero no provee nada de lo que el requisito nuevo pide: consulta
completa, tipos por campo, referencias por FK a los catálogos, corrección de registros individuales, ni
export server-side desde columnas tipadas.

## Decisión

Dos entidades:

- **`extraction`** — caché por documento. Guarda el texto fuente, la predicción **verbatim** del modelo
  (con labels **como strings**, que es lo que el modelo emite) y la `config` de la corrida.
- **`recommendation`** (+ su hija `recipient`) — la fila del dataset, **tipada y con FKs** a `topic`,
  `subtopic`, `macro_sector` y `organigram_unit`.

**Invariante:** *una fila de `recommendation` existe únicamente después de la validación humana.*

## Consecuencias

- La resolución **label → ID** es el post-procesamiento que separa inferencia de persistencia.
- **Todo `recipient` es, por construcción, revisado por una persona.** Eso permite que el índice aprendido
  nombre/cargo→sector del histórico (`llm_validated_destinatario`) **deje de necesitar tabla propia**: pasa a
  ser una consulta sobre `recipient` con columnas normalizadas indexadas. Se elimina una tabla denormalizada
  que había que mantener sincronizada, y el candidato validado pasa a traer `sector_id` en vez de un string.
- **`recipient.id` estable elimina el bug de emparejamiento por índice** del frontend histórico, que el
  propio contrato llamaba *"lo más importante"* y que se rompía apenas alguien borraba un destinatario antes
  de guardar.
- El texto verbatim del modelo **se conserva siempre** junto a la referencia resuelta.
- El dataset **no incluye** documentos procesados y no validados; eso sale de `extraction`.
- Invalidar una `extraction` **nunca destruye trabajo humano**, a diferencia del histórico donde
  `prediction` y `validation` compartían fila.

## Alternativas consideradas

- **Una sola tabla con JSON**, como el histórico. Rechazada: el dataset no queda consultable ni tipado.
- **Una sola tabla tipada.** Rechazada: obligaría al esquema del dataset a admitir salida cruda del modelo,
  incluidos valores inválidos.
