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
  // Seguimiento y destinatarios de las recomendaciones registradas.
  grilla: {
    title: "Seguimiento",
    headerTitle: "Recomendaciones · Seguimiento",
    tabs: {
      label: "Vistas de recomendaciones",
      seguimiento: "Recomendaciones",
      recipients: "Destinatarios",
    },
    export: {
      download: "Exportar set de datos",
      pending: "Exportando set de datos…",
      failed: "No se pudo exportar la base. Intentá nuevamente.",
    },
    recipients: {
      role: "Tipo de destinatario",
      primary: "Principal",
      secondary: "Secundario",
      empty: "Sin destinatarios registrados",
      name: "Nombre",
      position: "Cargo",
      unit: "Unidad",
      sector: "Destinatario por Sector",
    },
    subtitle:
      "Seguimiento de las recomendaciones registradas en el Set de Datos",
    filters: {
      searchLabel: "Buscar recomendaciones",
      searchPlaceholder:
        "Destinatario, sector, tema, subtema, número, expediente, detalle, contenido o enlace",
      title: "Filtros",
      button: "Filtros",
      open: "Mostrar filtros",
      close: "Ocultar filtros",
      topic: "Tema",
      subtopic: "Subtema",
      recipientSector: "Destinatario por Sector",
      situation: "Situación",
      status: "Estado",
      publication: "Aprobada para publicar",
      all: "Todos",
      unanswered: "Sin informar",
      catalogLoading: "Cargando sectores…",
      catalogFailed: "No se pudieron cargar los sectores. Intentá nuevamente.",
      sectorPlaceholder: "Buscar sector",
      clearSearch: "Limpiar la búsqueda",
      dateFrom: "Fecha desde",
      dateTo: "Fecha hasta",
      editedFrom: "Última edición desde",
      editedTo: "Última edición hasta",
      reset: "Limpiar filtros",
    },
    columns: {
      recommendationNumber: "Nº de recomendación",
      recommendationDate: "Fecha",
      topic: "Tema",
      subtopic: "Subtema",
      recipient: "Destinatario principal",
      publishableContent: "Contenido para publicar",
      fileNumber: "Nº de expediente",
      recommendationDetail: "Detalle de la Situación",
      recommendationSituation: "Situación",
      status: "Estado",
      approvedForPublication: "Aprobada para publicar",
      link: "Enlace",
      lastEdited: "Última edición",
      edit: "Editar",
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
  // Edición de una recomendación ya validada. Conserva un namespace propio:
  // no es el paso 3 inicial, aunque reutilice su formulario y su composición.
  correction: {
    title: "Recomendaciones · Editar validación",
    sectionTitle: "Datos de la recomendación validada",
    originalDocumentLabel: "Documento original",
    // El `<Spinner />` es un gráfico decorativo sin nombre accesible: sin este
    // texto la pantalla de carga no anuncia nada.
    loading: "Cargando la recomendación…",
    save: "Guardar edición",
    saveAnyway: "Guardar de todos modos",
    cancel: "Cancelar",
    back: "Volver a seguimiento",
    loadFailed:
      "No se pudo cargar la recomendación. Revisá tu conexión e intentá nuevamente.",
    predictionUnavailable:
      "No se pudo reconstruir la extracción original de esta recomendación, así que no se puede editar desde acá.",
    // Dos mensajes, no uno: `saveFailed` es el caso en que la petición ni
    // llegó a destino (sin `response`), donde hablar de la conexión ayuda;
    // `saveRejected` es cuando el servidor SÍ respondió con un error (422,
    // 500, 404 porque la fila se borró en otra ventana), donde culpar a la
    // conexión manda a revisar lo único que seguro está bien.
    saveFailed:
      "No se pudo guardar la edición. Revisá tu conexión e intentá nuevamente.",
    saveRejected:
      "No se pudo guardar la edición. Revisá los datos e intentá nuevamente.",
    // 412: el `If-Match` viajó con una versión que ya quedó vieja. Reintentar
    // solo pisaría el guardado de la otra persona, así que hay que recargar.
    conflict:
      "Este registro fue modificado por otra persona mientras lo editabas. Recargá los datos para ver la versión más reciente antes de volver a guardar.",
    reload: "Recargar datos",
    reloadFailed:
      "No se pudieron recargar los datos. Revisá tu conexión e intentá nuevamente.",
  },
  finish: {
    sectionTitle: "4. Finalización",
    description:
      "Los datos encontrados por AymurAI y validados en el paso anterior ya son parte de la base estructurada de recomendaciones.",
    subtitle: "Archivo procesado",
    restart: "Procesar otro documento",
    download: "Exportar set de datos",
    downloadFailed:
      "No se pudo descargar el archivo. Revisá tu conexión e intentá nuevamente.",
    viewGrilla: "Ir a seguimiento",
  },
};

export default recommendations;
