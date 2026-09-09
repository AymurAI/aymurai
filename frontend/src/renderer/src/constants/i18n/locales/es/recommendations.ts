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
    alreadyValidated:
      "Este documento ya fue validado. Podés modificar los datos antes de continuar.",
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
    isPrimary: "¿Es destinatario principal?",
    isPrimaryYes: "Sí",
    isPrimaryNo: "No",
    macroSector: "Sector",
    macroSectorOutOfCatalog: "Sector fuera de la lista definida",
    topic: "Tema",
    subtopic: "Subtema",
    topicOutOfCatalog: "Tema fuera de la taxonomía definida",
    subtopicOutOfCatalog: "Subtema fuera de la taxonomía del tema seleccionado",
    personalData: "¿El contenido incluye datos personales?",
    personalDataYes: "Sí",
    personalDataNo: "No",
    publishableContent: "Contenido para publicar",
    validate: "Validar documento",
    saveFailed:
      "No se pudo guardar la validación. Revisá tu conexión e intentá nuevamente antes de continuar.",
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
  },
};

export default recommendations;
