# AymurAI

Asistencia a organismos públicos en el procesamiento de documentos: anonimización, transcripción,
resumen y extracción estructurada de datos. Este glosario fija el vocabulario del dominio; las
decisiones de fondo viven en [`docs/adr/`](docs/adr/).

Es un glosario y nada más: no describe implementación ni contiene decisiones.

## Language

### Extracción y dataset

**Extracción**:
Lo que el modelo respondió sobre un documento, conservado tal cual lo emitió.
_Avoid_: predicción, inferencia, resultado

**Recomendación**:
Una recomendación de la Defensoría, tal como una persona la validó. Existe únicamente
después de esa validación.
_Avoid_: registro, entrada, fila, documento

**Dataset**:
El conjunto de recomendaciones que pertenece a una instancia del sistema. Es visible
íntegro para cualquier cliente conectado a ella.
_Avoid_: base, planilla, set de datos

**Destinatario**:
A quién va dirigida una recomendación. Una recomendación puede tener varios; uno es el
principal.
_Avoid_: receptor, dirigido

**Campos de seguimiento**:
Los campos que describen qué pasó con una recomendación después de publicarla: expediente,
detalle, situación, estado, aprobación para publicar y enlace.
_Avoid_: columnas manuales, campos manuales, columnas del template

### Los dos verbos

**Validar**:
Confirmar, campo por campo, qué dice un documento. Es el acto que hace nacer una
recomendación, y requiere tener el documento a la vista.
_Avoid_: cargar, procesar

**Corregir**:
Arreglar lo que quedó mal en una recomendación ya validada. Requiere el texto fuente y la
respuesta del modelo, porque se está discutiendo qué dice el documento.
_Avoid_: editar

**Seguimiento**:
Mantener al día los campos de seguimiento de una recomendación. No requiere el documento:
no se está discutiendo qué dice, sino qué pasó después.
_Avoid_: actualización, gestión

### Organigrama

**Unidad**:
Un nodo del organigrama del GCBA: un cargo dentro de la estructura, con su jerarquía.
_Avoid_: nodo, cargo, dependencia, repartición

**Titular**:
La persona que ocupa una unidad. Se conserva el historial; una sola es la vigente.
_Avoid_: responsable, funcionario

**Sector**:
La unidad de referencia de la que depende otra: su ancestro —o ella misma— más profundo
marcado como sector. Es siempre una unidad del organigrama.
_Avoid_: área, dependencia, jurisdicción

**Sector macro**:
El ámbito al que pertenece un destinatario cuando no es una unidad del GCBA: organismo
nacional, obra social o prepaga, empresa. Distinto de **sector**, que es del organigrama.
_Avoid_: ámbito, sector (a secas)

### Superficies y artefactos

**Workbook exportado**:
La foto fechada del dataset en formato de hoja de cálculo. Es de sólo lectura: sale del
sistema y nunca vuelve a entrar.
_Avoid_: planilla, export, set de datos

**Grilla de seguimiento**:
La superficie dentro de la aplicación donde se leen las recomendaciones del dataset y se
editan sus campos de seguimiento.
_Avoid_: planilla de seguimiento, tabla del dataset
