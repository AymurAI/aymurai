# ADR-0004 — El alcance compartido se modela con una entidad `dataset`

**Fecha:** 2026-08-27 · **Estado:** aceptada

## Contexto

El requisito es que **todos los clientes conectados a la misma instancia vean el dataset íntegro**,
independientemente de desde qué cliente se procesó cada documento.

El estado de partida es que **no hay aislamiento que romper**: el conjunto completo de dependencias FastAPI
del backend es `Depends(get_session)` y `Depends(get_transcribe_base_url)`; ninguna tabla tiene columna de
usuario, owner o tenant; no hay auth ni identidad de cliente. El `document_id` es un hash del contenido del
archivo, **derivable offline** por cualquiera que tenga el mismo documento.

El brief pide explícitamente *"modelar explícitamente ese concepto en vez de eliminar controles de ownership
de manera indiscriminada"*.

## Decisión

Una entidad **`dataset`** a la que pertenecen los registros.

**Invariante:** todo el contenido de un `dataset` es visible para cualquier cliente conectado a la
instancia. **No hay columna de ownership porque no hay owner**: el dataset pertenece a la instancia, no a un
cliente.

## Consecuencias

- El alcance es una **propiedad del dataset**, no la ausencia de una regla. Es la diferencia entre "esto es
  compartido a propósito" y "nadie puso un control".
- Si algún día hace falta acotar visibilidad, la columna va en `dataset` y **los registros no se tocan**.
- Permite que convivan varios datasets sin inventar tenencia hoy.
- `UNIQUE (dataset_id, document_id)`: una recomendación por documento y por dataset.
- **No se introduce auth.** Sigue valiendo que cualquiera que alcance la API puede leer y escribir. Este ADR
  no cierra ese agujero; lo delimita y lo deja explícito.

## Alternativas consideradas

- **Sin columna de alcance, invariante documentada.** Rechazada: es exactamente "no tener controles", que es
  lo que el brief pide evitar.
- **Columna `scope`/`workspace_id` en cada registro.** Rechazada: agrega una columna sin consumidor y sin
  semántica definida, y hay que llenarla en cada inserción sin saber con qué.
