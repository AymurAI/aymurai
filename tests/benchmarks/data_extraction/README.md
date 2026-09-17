# Benchmark de `/llm/data-extraction`

Mide, contra un ground truth real, qué tan bien el pipeline de extracción +
matching de organigrama:

1. Detecta la cantidad correcta de destinatarios por documento.
2. Clasifica el sector macro de cada destinatario (GCBA / Organismos
   Nacionales / Obra Social-Prepaga / Empresa).
3. Para destinatarios GCBA: si el sector correcto aparece en el top-1/3/5 de
   `sector_candidates`.

## Datos (no van en git)

`data/` está gitignored -- tiene nombres y cargos reales de personas. Cada
persona que corra esto necesita poner ahí:

- `data/pdfs/` — los documentos (recursivo, `.pdf`/`.docx`).
- `data/documento_sector_ground_truth.xlsx` — columnas `resolución`,
  `destinatario_idx`, `nombre`, `cargo`, `sector_ground_truth`. `resolución`
  debe matchear el nombre de archivo en `data/pdfs/`. `sector_ground_truth`
  en `"no definido"` se excluye de toda comparación de sector (cuenta sólo
  para el chequeo de cantidad de destinatarios). Para no-GCBA, uno de
  `Empresa` / `Organismos Nacionales` / `Obra Social / Prepaga`; para GCBA,
  el nombre o el acrónimo (ej. `AGC`) de la unidad del organigrama.

## Levantar la instancia de benchmark (una vez)

Una API separada de tu instancia de desarrollo normal, con su propia base
sembrada (organigrama/catálogos reales, pero **sin** recipient/recommendation
previos -- si no, el índice aprendido reusaría validaciones viejas y
contaminaría la medición):

```bash
cd "aymurai 2.0/aymurai"  # raíz del repo
rm -f .tmp/benchmark.db
SQLALCHEMY_DATABASE_URI="sqlite:///.tmp/benchmark.db" uv run --active alembic -c aymurai/alembic.ini upgrade head
SQLALCHEMY_DATABASE_URI="sqlite:///.tmp/benchmark.db" PYTHONPATH=. uv run --active python -m aymurai.scripts.seed catalogs
SQLALCHEMY_DATABASE_URI="sqlite:///.tmp/benchmark.db" PYTHONPATH=. uv run --active python -m aymurai.scripts.seed organigram

# queda corriendo en otra terminal/pestaña:
SQLALCHEMY_DATABASE_URI="sqlite:///.tmp/benchmark.db" API_PORT=8001 PYTHONPATH=. uv run --active python -m aymurai.api.main
```

También necesitás `llama-server` (u otro backend LLM) corriendo y accesible
vía `LLAMACPP_BASE_URL` (se hereda de tu `.env`, no hace falta nada especial
acá).

## Correr el benchmark

```bash
cd "aymurai 2.0/aymurai"  # raíz del repo
PYTHONPATH=. uv run --active python tests/benchmarks/data_extraction/benchmark_data_extraction.py
```

Opciones (todas opcionales, con defaults sensatos):

- `--ground-truth PATH` / `--pdf-root PATH` — default: `data/` de esta carpeta.
- `--model TEXT` — fuerza un modelo distinto en `/llm/data-extraction` (para
  comparar modelos entre corridas).
- `--api-base-url URL` — default `http://localhost:8001`.
- `--force-rerun` — ignora una corrida idéntica ya guardada y vuelve a
  llamar al LLM para todo.

## Qué guarda y dónde

- **`benchmark_tracking.db`** (gitignored, tiene nombre/cargo reales del
  ground truth): versiona el ground truth por hash de contenido -- si no
  cambió, no crea una versión nueva. Cada corrida se identifica por
  `(modelo, hash del prompt vigente, versión de ground truth)`: si ya existe
  una corrida idéntica, se reusa entera (no se vuelve a llamar al LLM). Si
  una corrida quedó a medias, la siguiente invocación retoma sólo los
  documentos que faltan.
- **`runs/run-<id>.md`** (trackeado en git -- sólo métricas agregadas, nunca
  datos personales): el reporte de esa corrida, con una tabla de historial
  comparando contra todas las corridas anteriores guardadas.

Para comparar otro modelo o prompt: pasá `--model` distinto, o editá
`resources/llm/data_extraction.yml` -- cualquiera de los dos hace que la
próxima corrida se detecte como distinta y genere un reporte nuevo en vez de
reusar el anterior.
