const recommendations = {
  title: "Recomendaciones",
  subtitle:
    "Registra las recomendaciones de la Defensoría en una base estructurada",
  process: {
    sectionTitle: "2. Extracción de datos",
    processingTitle: "AymurAI está extrayendo los datos de los archivos.",
    processingSubtitle: "Este proceso puede tardar algunos minutos.",
    extracting: "Extrayendo datos… {{elapsed}}",
    errorText: "Ocurrió un error al extraer los datos del documento.",
    noTextError:
      "No se pudo extraer texto del documento. Puede tratarse de un PDF escaneado o de imágenes. Volvé atrás y cargá un archivo con texto seleccionable.",
    retry: "Reintentar",
    next: "Siguiente",
  },
  validation: {
    sectionTitle: "3. Validación de datos",
    originalDocumentLabel: "Documento original",
    storedInference: "Se recuperó una extracción previa de este documento.",
    alreadyValidated:
      "Este documento ya fue validado. Podés modificar los datos antes de continuar.",
    catalogsStale:
      "La taxonomía de temas o sectores cambió desde que se generó esta extracción. Podés volver a extraer los datos con la información actualizada.",
    reExtract: "Volver a extraer",
    missingPrediction:
      "No se encontró la información extraída para este documento.",
    recommendationNumber: "Número de recomendación",
    recommendationDate: "Fecha de la recomendación",
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
};

export default recommendations;
