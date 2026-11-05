# ADR-0015 — Situación y estado son catálogos cerrados en el código, no ABM

**Fecha:** 2026-09-21 · **Estado:** aceptada

## Contexto

PR #76 sumó los campos de seguimiento al modelo de la recomendación. Dos de ellos —la **situación de la
recomendación** y su **estado**— tienen valores acotados. El plan de ese PR los dejó como texto libre con una
pregunta abierta para las personas usuarias, y con una advertencia explícita: conviene resolverlo **antes** de
construir la pantalla de edición, porque migrar un campo de texto libre a una referencia de catálogo **después**
de tener datos cargados cuesta bastante más que hacerlo antes.

Las personas usuarias definieron las categorías admisibles en una instancia de debate específica, y pidieron
que fueran **las únicas posibles**. Ese acuerdo es lo que hay que proteger.

La tensión es que las fases 1 y 7 dejaron andando el patrón opuesto para temas, subtemas y sectores macro:
tabla en la base, semilla inicial y alta/baja/modificación desde la pantalla de Configuración. Quien lea el
código va a ver tres catálogos editables y estos dos fijos, sin forma de saber por qué.

## Decisión

Se modelan como **catálogos cerrados en el código**, con una restricción de verificación en la base, no como
tablas administrables desde la aplicación.

- **Situación de la recomendación:** Respuesta · Respuesta parcial · Notificado
- **Estado:** Solucionado · No solucionado

## Consecuencias

- **Agregar o renombrar un valor es un cambio de código, una migración y un despliegue**, no una edición en
  Configuración. Se acepta a cambio de que el conjunto **no pueda ampliarse por accidente**: la editabilidad
  sería una invitación permanente a romper el acuerdo que lo fijó.
- Se persiste la **etiqueta** que ve una persona, no el nombre interno del miembro, y la restricción vive como
  verificación de texto en cualquier motor. Un valor fuera del conjunto falla en la validación y en la base:
  **nunca se guarda en silencio**.
- El conjunto vive en **un solo lugar del backend**, pero el frontend **todavía no lo conoce**: su esquema de
  validación no declara los dos campos y no hay generación de tipos desde el contrato de la API. La pantalla
  de seguimiento tiene que resolver de dónde toma esos valores **sin crear una cuarta copia de un catálogo**
  (ANALYSIS §C.3, problema 1).
- Si mañana las personas usuarias piden ampliar el conjunto, la migración a tabla con referencia sigue
  disponible. Su costo es el que el plan de PR #76 advirtió, y se asume a sabiendas.

## Alternativas consideradas

- **Tabla administrable, como temas y subtemas.** Rechazada: agrega una pantalla y una semilla para un
  conjunto que se pidió cerrado, y vuelve editable justo lo que se acordó que no lo fuera.
- **Texto libre**, que es lo que tenía el plan de PR #76. Rechazada: no expresa la restricción en ningún
  lado y deja que cada persona escriba su propia variante de la misma categoría.
