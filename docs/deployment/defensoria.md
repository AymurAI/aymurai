# AymurAI | Defensoria deployment

Language: **English** | [Español](../es/deployment/defensoria.md)

A release tag publishes separate standard and Defensoria images. Production
must use the versioned `ghcr.io/aymurai/api:<tag>-defensoria` tag; the floating
`defensoria` tag is only a convenience. A manual branch dispatch publishes only
immutable `dev-<sha>` tags and never moves floating tags. The
`full-<tag>-defensoria` variant is also published, but the lite image is
preferred because extraction uses the external llama.cpp service.

The deployment requires DNS and TLS, a persistent `/resources/cache` mount, a
host-only GGUF, and a reverse-proxy access policy. AymurAI has no authentication,
so the service must not be exposed directly to the public Internet.

Use [`.env.schema`](../../.env.schema) as the configuration contract. Set
`DEFENSORIA_ENABLED=true`, the public origin in `CORS_ORIGINS`, the GGUF name,
and a `65536` llama.cpp context. Store credentials outside Git and validate
them with `varlock load --agent`.

The taxonomy and organigram inputs are private deployment data and are not in
the image. After the API healthcheck succeeds and Alembic has run, mount their
directory read-only into a one-off API container and run `aymurai-seed catalogs`
and `aymurai-seed organigram` with explicit `/seed/...` paths. Both commands are
idempotent; remove the mount after seeding.

Smoke-test the healthcheck, non-empty catalog and organigram endpoints, the
flagged frontend navigation, one end-to-end document, and the XLSX export.
Take a one-shot database backup before every update and roll back by restoring
the previous versioned image without re-seeding.

The detailed operator commands and the current `case` prerequisites are in the
[Spanish runbook](../es/deployment/defensoria.md).
