# Despliegue de AymurAI | Defensoría

Este runbook publica la variante gateada sin alterar la distribución estándar.
Un tag de release produce estas etiquetas:

| Variante | Versionada | Flotante |
|---|---|---|
| Estándar | `ghcr.io/aymurai/aymurai:<tag>` | `latest` |
| Defensoría | `ghcr.io/aymurai/aymurai:<tag>-defensoria` | `defensoria` |
| Full estándar | `ghcr.io/aymurai/aymurai:full-<tag>` | `full` |
| Full Defensoría | `ghcr.io/aymurai/aymurai:full-<tag>-defensoria` | `full-defensoria` |

En producción usá siempre una etiqueta versionada. La variante liviana es la
recomendada para Defensoría: la extracción usa el `llama-server` externo y no
necesita los modelos clásicos embebidos por la imagen `full`.

Un dispatch manual desde una branch publica sólo `dev-<sha>` y
`dev-<sha>-defensoria` (más sus variantes `full-`); nunca mueve los tags
flotantes.

## Prerrequisitos

- Registro DNS para el dominio, apuntando al servidor.
- Reverse proxy con TLS hacia un puerto local de la API.
- Autenticación o control de acceso en el proxy. AymurAI no implementa auth;
  no expongas esta instancia directamente a Internet.
- Un GGUF compatible disponible sólo en el host.
- Directorios persistentes para `/resources/cache` y backups.
- Los tres archivos de seed en un directorio privado del host. No se incluyen
  en la imagen ni se deben subir a GHCR.

## Configuración

Partí de [`.env.schema`](../../../.env.schema). Guardá valores sensibles en el
secret store del servidor o en archivos locales ignorados por Git y validalos
con `varlock load --agent`; nunca los pegues en logs o comandos compartidos.

Valores indispensables para esta distribución:

```dotenv
DEFENSORIA_ENABLED=true
CORS_ORIGINS=https://aymurai.defensoria.collectiveai.io
LLAMACPP_MODEL_FILE=modelo.gguf
LLAMACPP_CTX_SIZE=65536
LLAMACPP_BASE_URL=http://llamacpp:8080/v1
```

El contenedor de API y el bundle web reciben el mismo flag durante el build. Un
override de runtime puede apagar los routers, pero no puede reconstruir el
frontend; por eso hay etiquetas de imagen separadas.

## Arranque y seed

1. Hacé pull de la etiqueta versionada y levantá `llamacpp`, la API y el
   sidecar de backups con el Compose del host.
2. Esperá `200` en `/api/server/healthcheck`; el startup aplica Alembic antes
   de aceptar tráfico.
3. Montá temporalmente el directorio privado de seed como `/seed:ro` y ejecutá:

```bash
docker compose run --rm --no-deps \
  -v /ruta/privada/defensoria:/seed:ro \
  aymurai-api /app/.venv/bin/aymurai-seed catalogs \
  --taxonomy-path /seed/defensoria_taxonomy.json

docker compose run --rm --no-deps \
  -v /ruta/privada/defensoria:/seed:ro \
  aymurai-api /app/.venv/bin/aymurai-seed organigram \
  --organigram-path /seed/organigram_GCBA.json \
  --csv-path /seed/destinatario_por_sector.csv
```

Ambos comandos son idempotentes, pero el seed no corre automáticamente. Quitá
el montaje cuando termina.

## Smoke y rollback

Verificá, en orden:

1. `GET /api/server/healthcheck` devuelve `200`.
2. `GET /api/catalogs/topics` y `GET /api/organigram/units?flat=true` devuelven
   colecciones no vacías.
3. La portada muestra el flujo de recomendaciones y las pantallas de
   Nomenclador/Organigrama.
4. Un documento real completa carga, extracción, validación y guardado.
5. La exportación `.xlsx` descarga las filas validadas.

Antes de actualizar, ejecutá el backup one-shot. Para rollback, fijá la imagen
versionada anterior, recreá sólo la API y conservá el volumen de
`/resources/cache`; no vuelvas a sembrar para revertir una versión.
