# ADR-0016 — La grilla de seguimiento se alcanza desde el flujo de recomendaciones, no desde el menú de features

**Fecha:** 2026-10-01 · **Estado:** aceptada

## Contexto

El issue #58 (Fase 9), en su tajada A, pedía tres accesos a la grilla de seguimiento (`/home/dataset`),
todos gateados por el flag de la Defensoría ([ADR-0007](0007-distribucion-gateada-por-feature-flag.md)):

- una **entrada en `FeaturesMenu`**, el popover del header presente en todas las pantallas;
- una **quinta tarjeta a ancho completo en `/home/features`**, debajo de las cuatro de las features;
- un **botón en el paso 4** del flujo de recomendaciones (`recommendation-finish.tsx`).

Además, la ruta se montaba dentro de `HomeLayout variant="wide"`, la variante de contenido ancho que usan las
pantallas de Configuración.

Las dos primeras se construyeron y después se sacaron (`0f936dc`), junto con `HomeLayout variant="wide"`. La
referencia visual de toda la Fase 8 y la Fase 9 es la implementación histórica de escritorio de la Defensoría
(`desktop-app @ feat/recomendaciones-defensoria`): las pantallas que el equipo ya había revisado y aceptado, que
se portan píxel a píxel y sólo se recablean contra la API. En esa implementación, la grilla no es una feature
más del menú ni una tarjeta de la portada: es parte del flujo de recomendaciones, y se llega a ella desde ahí.
Las dos entradas del issue ponían la grilla en un lugar donde la implementación de referencia no la tiene.

## Decisión

**La grilla se alcanza desde el flujo de recomendaciones: desde su onboarding y desde su paso 4. No tiene
entrada en `FeaturesMenu` ni tarjeta en `/home/features`.**

- El **onboarding de Recomendaciones** muestra un botón secundario "Ir a seguimiento" junto al de carga de
  documentos, gateado por `isDefensoriaEnabled()`.
- El **paso 4** conserva su botón, que la tajada A ya pedía.
- La ruta deja `HomeLayout variant="wide"` y arma su propia composición de pantalla completa
  (`Header` + `MainContent full`), la misma familia que la pantalla de corrección.

## Consecuencias

- **Se pierde descubribilidad, a sabiendas.** Una persona que no entra al flujo de recomendaciones no tiene
  cómo enterarse de que la grilla existe: no aparece en el menú del header ni en la portada. Es el precio de
  alinear con la implementación de referencia, y es aceptable porque quien trabaja la grilla es la misma
  persona que valida recomendaciones — no hay un público que llegue a la grilla sin pasar por el flujo.
- **El acceso desde el onboarding no saca a nadie de un flujo a medias.** El menú de features llama a
  `removeAllFiles()` al navegar; desde el onboarding todavía no se cargó ningún archivo, y desde el paso 4 la
  recomendación ya está guardada. Ninguno de los dos accesos que quedan puede tirar una validación sin guardar.
- **La URL sigue siendo directa.** `/home/dataset` y `/home/dataset/$recommendationId` no dependen de por
  dónde se entró, y la ruta sigue sin gatearse a sí misma: el flag gatea las entradas, no la pantalla (mismo
  criterio que el resto de `/home/*`).
- **Si la descubribilidad resulta un problema**, la reversión es barata y está en la historia: las dos
  entradas viven en el commit anterior a `0f936dc`, con sus tests. Volver a agregarlas es una decisión aparte
  que enmienda este ADR, no un descuido a corregir.

## Supersede

Reemplaza, de la tajada A del issue #58, los checkboxes de **entrada en `FeaturesMenu`**, **quinta tarjeta en
`/home/features`, a ancho completo** y la parte de **"con la variante de contenido ancho de `HomeLayout`"** de
la ruta `/home/dataset`, junto con el test que exigía que *"la entrada del menú y la tarjeta no se rendericen
con el flag apagado"*. El botón del paso 4 y el resto de la tajada siguen vigentes.

## Alternativas consideradas

- **Las tres entradas del issue, tal cual.** Rechazada: pone la grilla en dos lugares donde la implementación
  de referencia no la tiene, y la Fase 8 ya había fijado que esas pantallas se portan, no se rediseñan.
- **Sólo la tarjeta en `/home/features`, sin la entrada del menú.** Rechazada por el mismo motivo, y porque una
  tarjeta a ancho completo debajo de las cuatro features la presenta como una feature más, cuando es la
  continuación de una de ellas.
