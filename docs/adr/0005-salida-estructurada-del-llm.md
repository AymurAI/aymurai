# ADR-0005 — Salida estructurada con enums nullables explícitos

**Fecha:** 2026-08-27 · **Estado:** aceptada

## Contexto

La implementación histórica pedía JSON por prompt y lo parseaba con tolerancia (`_parse_json_object` saltea
fences y prosa), validando después con pydantic y reintentando ante fallo. El monorepo no usa salida
estructurada en ningún lado: hay incluso un test que **afirma que `response_format` no se envía**.

## Decisión

Usar **`response_format: {"type": "json_schema"}`**, y expresar **todo campo nullable como `enum` que
incluye `null` explícitamente**.

## Evidencia

Medido contra `gemma-4-12B-it-Q4_0` con una entrada que no corresponde a ningún tema:

| Variante de schema | Resultado |
|---|---|
| `{"enum": [...valores, null]}` | ✓ devuelve `null` |
| `{"anyOf": [{"enum": [...]}, {"type": "null"}]}` | ✓ devuelve `null` |
| **`{"type": ["string","null"], "enum": [...]}`** | ✗ **fuerza un valor — el `null` se descarta en silencio** |
| `{"enum": [...valores]}` (control) | ✗ fuerza un valor |

**La forma idiomática de escribir un enum nullable en JSON Schema es la que no funciona.** El conversor a
GBNF de llama.cpp ignora construcciones no soportadas **sin error y sin warning**; también descarta
`if/then/else`, `uniqueItems`, `propertyNames` y `oneOf` con `properties` hermanas.

Forzado a elegir, el modelo clasificó una receta de cocina como `TURISMO`: **un enum obligatorio no produce
un error, produce una respuesta equivocada con forma correcta.**

En 4 documentos reales, structured y modo libre dieron **resultados idénticos** (JSON válido, 7/7 campos,
par tema/subtema válido), y la latencia de la gramática **no se distingue del ruido**.

## Justificación

Structured no compra precisión sobre este modelo — compra **garantía de forma**, y se paga por costo:

> Un reintento cuesta **una inferencia completa del documento**: entre 70 y 570 segundos según el tamaño. El
> sobrecosto de la gramática, cuando existe, es una fracción de eso.

Con la forma garantizada, el ciclo de reintento queda reservado para la validación **semántica** — el par
tema/subtema, que el schema no puede expresar de todos modos.

## Consecuencias

- Convención obligatoria: **nunca `type: [..., "null"]` junto a `enum`.** Debe cubrirse con un test que lo
  verifique contra el servidor, porque la degradación es silenciosa.
- El schema restringe `topic` (25 valores, 345 tokens). Los 242 subtemas **no** van al schema: la
  dependencia tema→subtema no es expresable, así que va en el texto del prompt y se valida en pydantic.
- Salida inválida tras agotar reintentos → **campos en `null`, no 502**: perder toda la extracción por un
  campo mal clasificado es peor que entregarla incompleta, sobre todo cuando la validación humana es
  obligatoria igual.
- La medición es sobre **4 documentos**: alcanza para descartar fallos groseros y para el hallazgo del enum,
  **no para medir tasa de acierto**.
