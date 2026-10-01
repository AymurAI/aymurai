import { documentFormats } from "./document-formats";

const recommendations = {
  title: "Recomendaciones",
  subtitle:
    "Registra las recomendaciones de la Defensoría en una base estructurada",
  onboarding: {
    sectionTitle: "1. Selección de archivo",
    loadDocuments: "Cargar documento",
    validFormats: documentFormats,
    dropAreaTitle:
      "Selecciona o arrastra el archivo para\nagregar a la base de recomendaciones",
    dropAreaFormats: documentFormats,
  },
  preview: {
    sectionTitle: "1. Selección de archivo",
    filesLabel: "Vista previa del documento",
    validFormats: documentFormats,
    loadMore: "Cargar más documentos",
    continue: "Continuar",
  },
  howItWorks: {
    step1: {
      alt: "Interfaz web con selector y cursor",
      title: "Selecciona el documento con la recomendación",
      subtitle:
        "Sube el documento que quieres incorporar a la base de recomendaciones.",
    },
    step2: {
      alt: "Barra de búsqueda con cursor",
      title: "La inteligencia artificial analiza el documento",
      subtitle:
        "Extrae automáticamente la información relevante de la recomendación.",
    },
    step3: {
      alt: "Visor de documentos con controles de revisión",
      title: "Revisión y validación humana",
      subtitle:
        "Es importante que verifiques que los datos sean correctos antes de continuar.",
    },
    step4: {
      alt: "Binoculares con globo terráqueo",
      title: "Registro de la recomendación",
      subtitle:
        "El documento pasa a formar parte de la base estructurada de recomendaciones de la Defensoría.",
    },
  },
  process: {
    sectionTitle: "2. Extracción de datos",
    processingTitle: "AymurAI está extrayendo los datos del archivo.",
    processingSubtitle: "Este proceso puede tardar algunos minutos.",
    finishedTitle: "AymurAI finalizó la extracción de datos del documento.",
    finishedSubtitle: "Puedes continuar con la validación de los datos.",
    errorTitle: "Ocurrió un problema al procesar el documento.",
    errorSubtitle: "El documento no pudo procesarse correctamente.",
    stoppedTitle: "Detuviste el procesamiento del documento.",
    stoppedSubtitle: "Vuelve atrás para reiniciar el procesamiento.",
    stoppedText: "El procesamiento del documento fue detenido manualmente.",
    storedInference: "Se recuperó una extracción previa de este documento.",
    alreadyValidated:
      "Este documento ya fue validado. Podés modificar los datos antes de continuar.",
    errorText: "Ocurrió un error al extraer los datos del documento.",
    noTextError:
      "No se pudo extraer texto del documento. Puede tratarse de un PDF escaneado o de imágenes. Vuelve atrás y carga un archivo con texto seleccionable.",
    stop: "Detener",
    completedAria: "Extracción completada",
    next: "Siguiente",
  },
  validation: {
    sectionTitle: "3. Validación de datos",
    originalDocumentLabel: "Documento original",
    catalogsStale:
      "La taxonomía de temas o sectores cambió desde que se generó esta extracción. Podés volver a extraer los datos con la información actualizada.",
    reExtract: "Volver a extraer",
    reExtractFailed:
      "No se pudo volver a extraer los datos. Revisá tu conexión e intentá de nuevo.",
    missingPrediction:
      "No se encontró la información extraída para este documento.",
    recommendationNumber: "Número de recomendación",
    recommendationDate: "Fecha de la recomendación",
    recommendationDateRaw: "Texto original detectado",
    recipientLabel: "Destinatario",
    removeRecipient: "Eliminar destinatario",
    name: "Nombre",
    position: "Cargo",
    unit: "Unidad del organigrama",
    // Lo que la Defensoría llama "destinatario por sector": el sector del
    // organigrama que contiene a la unidad. Coincide con la unidad sólo
    // cuando ésta es sector en sí misma (IVC, AGC y demás organismos
    // autónomos). Es lo que el export escribe como SECTOR_FINAL.
    sector: "Destinatario por sector",
    sectorMismatch:
      "La unidad no pertenece a este sector. Elegí una unidad del sector para poder guardar.",
    blockedBySectorMismatch:
      "No se puede validar: en {{recipients}} el sector no se condice con la unidad.",
    isPrimary: "¿Es destinatario principal?",
    isPrimaryYes: "Sí",
    isPrimaryNo: "No",
    // "Sector" quedó para el del organigrama; este campo es el ámbito al que
    // pertenece el destinatario (GCBA, Organismos Nacionales, etc.).
    macroSector: "Ámbito",
    macroSectorOutOfCatalog: "Ámbito fuera de la lista definida",
    topic: "Tema",
    subtopic: "Subtema",
    topicOutOfCatalog: "Tema fuera de la taxonomía definida",
    subtopicOutOfCatalog: "Subtema fuera de la taxonomía del tema seleccionado",
    personalData: "¿El contenido incluye datos personales?",
    personalDataYes: "Sí",
    personalDataNo: "No",
    publishableContent: "Contenido para publicar",
    validate: "Validar documento",
    validateAnyway: "Guardar de todos modos",
    // ADR-0013: un campo que nadie validó se guarda vacío. El aviso los nombra
    // antes de que eso pase; el segundo click guarda igual.
    unvalidatedFieldsWarning:
      "Sin validar: {{fields}}. Si guardás ahora esos campos quedan vacíos — apretá de nuevo para confirmar.",
    saveFailed:
      "No se pudo guardar la validación. Revisá tu conexión e intentá nuevamente antes de continuar.",
  },
  // La grilla de seguimiento (`/home/dataset`): la pantalla compartida donde
  // se completan los campos de seguimiento de cada recomendación publicada.
  // Un solo namespace para la pantalla y para las puertas que llevan a ella
  // (ítem del menú, tarjeta del home, botón de finalización): es una sola
  // superficie y lleva un solo nombre, "Seguimiento". Deliberadamente no
  // `dataset:title`: esa clave ya está en uso para la tarjeta y el ítem de
  // menú de Set de Datos (ver features-menu.tsx y routes/home/features.tsx).
  // El glosario (CONTEXT.md) descarta "base"/"planilla"/"set de datos" para
  // nombrar el dataset, así que ninguna cadena de acá los usa.
  grilla: {
    title: "Seguimiento",
    cardSubtitle: "Completá el seguimiento de las recomendaciones publicadas",
    subtitle: "Seguimiento compartido de las recomendaciones ya registradas",
    filters: {
      searchLabel: "Buscar recomendaciones",
      // Exactamente las cuatro columnas que busca el backend
      // (`_SEARCH_COLUMNS` en `database/crud/recommendation.py`). "Tema"
      // queda afuera: filtrar por tema exige un join (issue #58).
      searchPlaceholder: "Número, expediente, detalle o contenido",
      clearSearch: "Limpiar la búsqueda",
      dateFrom: "Fecha desde",
      dateTo: "Fecha hasta",
      unparsedDates: "Sólo fechas sin interpretar",
      reset: "Limpiar filtros",
    },
    columns: {
      recommendationNumber: "Nº de recomendación",
      recommendationDate: "Fecha",
      topic: "Tema",
      subtopic: "Subtema",
      recipient: "Destinatario principal",
      publishableContent: "Contenido para publicar",
      personalData: "Datos personales",
      fileNumber: "Nº de expediente",
      recommendationDetail: "Detalle del seguimiento",
      recommendationSituation: "Situación",
      status: "Estado",
      approvedForPublication: "Aprobada para publicar",
      link: "Enlace",
      lastEdited: "Última edición",
    },
    approved: {
      yes: "Sí",
      no: "No",
    },
    empty: "Todavía no hay recomendaciones registradas.",
    emptyFiltered: "Ninguna recomendación coincide con los filtros aplicados.",
    loadFailed:
      "No se pudieron cargar las recomendaciones. Revisá tu conexión e intentá nuevamente.",
    saveFailed:
      "Quedaron cambios sin guardar (marcados en rojo). Revisá tu conexión y volvé a editar esas celdas.",
    cellSaveFailed: "Sin guardar",
    enumsFailed:
      "No se pudieron cargar las listas de Situación y Estado. Esas dos columnas quedan bloqueadas hasta que se recuperen.",
    pagination: {
      range: "{{from}}-{{to}} de {{total}}",
      previous: "Página anterior",
      next: "Página siguiente",
    },
  },
  finish: {
    sectionTitle: "4. Finalización",
    description:
      "Los datos encontrados por AymurAI y validados en el paso anterior ya son parte de la base estructurada de recomendaciones.",
    subtitle: "Archivo procesado",
    restart: "Procesar otro documento",
    download: "Descargar la base de recomendaciones",
    downloadFailed:
      "No se pudo descargar el archivo. Revisá tu conexión e intentá nuevamente.",
    viewGrilla: "Ir a seguimiento",
  },
};

export default recommendations;
