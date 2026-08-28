const settings = {
  nav: {
    server: "Servidor",
    taxonomy: "Taxonomía",
    organigram: "Organigrama",
  },
  taxonomy: {
    topics: {
      title: "Temas",
      addAction: "Agregar tema",
      nameLabel: "Nombre",
      codeLabel: "Código",
      deactivateAction: "Dar de baja",
      deactivateConfirmTitle: "¿Dar de baja este tema?",
      usageWarning_one: "{{count}} registro usa este tema.",
      usageWarning_other: "{{count}} registros usan este tema.",
      confirmDeactivate: "Confirmar baja",
      cancel: "Cancelar",
    },
    subtopics: {
      title: "Subtemas",
      empty: "Selecciona un tema para ver sus subtemas",
      addAction: "Agregar subtema",
      nameLabel: "Nombre",
      deactivateAction: "Dar de baja",
      reassignAction: "Reasignar registros",
      reassignTargetLabel: "Reasignar a",
      reassignNone: "No reasignar",
      confirmReassign: "Confirmar reasignación",
    },
  },
  organigram: {
    tree: {
      title: "Organigrama",
      empty: "No hay unidades cargadas",
    },
    detail: {
      empty: "Selecciona una unidad del organigrama",
      nameLabel: "Cargo",
      acronymLabel: "Sigla",
      shortNameLabel: "Nombre corto",
      isSectorLabel: "Es sector",
      activeLabel: "Activo",
      currentHolderLabel: "Titular actual",
      noHolder: "Sin titular registrado",
      holderHistoryTitle: "Historial de titulares",
      newHolderLabel: "Nuevo titular",
      newHolderAction: "Registrar titular",
    },
  },
};

export default settings;
