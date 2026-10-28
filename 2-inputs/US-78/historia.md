# US-78 - Historia Pruebas IA

## Descripción

Implementar una opción para la compensación opcional de partidas. En la nueva opción de compensación de facturas, se debe Incluir una opción que permita pegar (desde otro archivo) los documentos que se van a compensar.      Adicional, en la pantalla principal, deben visualizarse por lo menos 10 a 25 filas de facturas disponibles y los filtros deben traer pre-marcadas las facturas y los rangos de fecha.  Importante, cuando se está en la opción de compensar, se debe usar la fecha del día, pero esta fecha puede variar según requerimiento del usuario.  La fecha del movimiento debe ser la del documento. Y el usuario puede cambiar la fecha de contabilización. Adicional, cuando utilice el filtro de incluir documentos específicos, ya venga marcado el check de la izquierda.

## Criterios de aceptación

Dado una partida pendiente de compensación,  
Cuando el usuario acceda al proceso de compensación,  
Entonces deberá visualizar la opción de &quot;Compensación&quot;. 
 
CA-02  
Cuando el usuario acceda a la opción, las partidas pendientes deben cuadrar con las que tiene el cliente en SAP (FBL5N) 
 
CA-03  
El sistema debe permtir seleccionar débitos y créditos o solo créditos o solo débitos y enviar a SAP 
 
CA-04 
El sistema debe permtir que haya un valor de diferencia positivo o negativo 
 CA-05 En la pantalla principal, deben visualizarse por lo menos 10 a 25 filas de facturas disponibles y los filtros deben traer pre-marcadas las facturas y los rangos de fecha.  CA-06  cuando se está en la opción de compensar, se debe usar la fecha del día, pero esta fecha puede variar según requerimiento del usuario.  La fecha del movimiento, debe ser la del documento. Y el usuario puede cambiar la fecha de contabilización.  CA-07 Cuando utilice el filtro de incluir documentos especificos, ya venga marcado el check de la izquierda.

## Azure DevOps

- ID: 78
- Tipo: Task
- Estado: To Do
- Prioridad: 2
- Área: Pruebas-TI IA
- Iteración: Pruebas-TI IA
- URL: https://dev.azure.com/GSID-Autogestion/9a29ac17-af10-48ab-88cd-1a7193a3900a/_workitems/edit/78
- Última modificación: 2026-09-21T17:06:16.537Z

- URL de pruebas: https://uniwebpro.geekqa.net/
