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
    recommendationNumber: "Número de recomendación",
    recommendationDate: "Fecha de la recomendación",
    recipientLabel: "Destinatario",
    removeRecipient: "Eliminar destinatario",
    name: "Nombre",
    position: "Cargo",
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
  },
};

export default recommendations;
