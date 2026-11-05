# ADR-0001 — El sector del GCBA es un atributo del nodo, no un conjunto de reglas

**Fecha:** 2026-08-27 · **Estado:** aceptada · **Enmendada:** 2026-09-17 (segunda implementación de la
regla, en el cliente)

## Contexto

La implementación histórica derivaba el "sector" de un destinatario aplicando **cinco reglas de texto en
orden de prioridad** sobre la ruta del organigrama (`sector_matching.resolve_sector_from_hierarchy`):

1. Organismos autónomos, por lista de keywords hardcodeada (AGC, AGIP, IVC, COPIDIS), que anulan a su padre
   administrativo.
2. Cualquier segmento que empiece con `ministerio`.
3. Cualquier segmento que empiece con `secretaria` — excluyendo `subsecretaria` por el prefijo `sub`.
4. `Jefatura de Gabinete de Ministros` en la ruta.
5. El primer segmento no genérico.

Cambiar ese comportamiento —por ejemplo, cuando el gobierno crea un organismo de un tipo nuevo— exige
**editar expresiones regulares en Python**. El requisito de la Defensoría es lo contrario: actualización
manual fácil, que impacte directamente en cómo se resuelven los destinatarios.

## Decisión

`organigram_unit` lleva un booleano **`is_sector`**. El sector de un nodo es **el ancestro-o-sí-mismo más
profundo con `is_sector = true`**.

El seed corre las cinco reglas históricas **una única vez** para setear el flag, y después **las reglas se
borran del código**.

## Evidencia

Medido sobre el organigrama real (520 nodos, 489 con titular, profundidad 7):

- Los **33 sectores derivados son todos nodos reales** del árbol; ninguno es un string sintetizado.
- La regla del flag reproduce las cinco reglas **exactamente: 489/489 nodos**, comparado a nivel de
  identidad de nodo.
- Los nodos-sector viven en **profundidades 2, 3 y 4**, así que ninguna regla basada en nivel funcionaría.

## Consecuencias

- El conocimiento de las cinco reglas queda **materializado en 33 booleanos** editables desde la UI.
- Desaparecen `_AUTONOMOUS_BODY_KEYWORDS` y las cuatro reglas de texto.
- Junto con el descarte del CSV (ADR-0006), **`sector_matching.py` completo (443 líneas) deja de existir**.
- El flag hay que exponerlo en el ABM del organigrama: es un campo que la persona tiene que poder ver y cambiar.
- Un seed mal corrido produce sectores mal asignados de forma silenciosa → debe cubrirse con un test que
  compare contra las reglas sobre el archivo real.
- **La regla tiene ahora dos implementaciones** *(enmienda 2026-09-17)*. Al pasar el filtrado de unidades por
  sector al cliente ([ADR-0012](0012-ranking-en-el-backend-filtrado-en-el-cliente.md)), el frontend necesitó
  caminar el mismo árbol: `frontend/src/renderer/src/utils/organigram/resolve-sector.ts` es el espejo de
  `resolve_sector` sobre el corpus plano que `listUnits()` ya trae, más `normalize-for-search.ts` espejando
  `normalize_text`. Son funciones puras y testeadas, pero **es duplicación de una regla de dominio**: si la
  definición de sector cambia, hay que cambiarla en dos lenguajes o la UI y el server empiezan a discrepar en
  silencio. Vale la pena saber, además, que el espejo tiene una asimetría deliberada que el original también
  tiene: `resolveSector` exige `is_sector && active`, mientras que `isSectorAncestorOf` —pertenencia, usada
  para detectar el par inconsistente— ignora `active`, para no declarar inconsistente un par que se validó
  antes de que alguien desactivara la unidad.

## Alternativas consideradas

- **Mantener las reglas.** Rechazada: deja en código algo que el dominio necesita editar.
- **Sector como entidad aparte.** Rechazada: los 33 sectores *son* nodos del árbol; duplicarlos como entidad
  crearía un segundo catálogo que mantener sincronizado.
- **Regla por profundidad.** Imposible: los sectores están en tres niveles distintos.
